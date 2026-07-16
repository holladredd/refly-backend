import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import OpenAI from 'openai';
import axios from 'axios';
import ytSearch from 'yt-search';

// @desc    Create new conversation
// @route   POST /api/conversations
// @access  Private
export const createConversation = async (req, res) => {
  try {
    const { title, modelUsed } = req.body;
    const conversation = await Conversation.create({
      userId: req.user._id,
      title: title || 'New Conversation',
      modelUsed: modelUsed || 'grok',
    });
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all conversations for logged in user
// @route   GET /api/conversations
// @access  Private
export const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id })
      .sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get conversation details and messages
// @route   GET /api/conversations/:id
// @access  Private
export const getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 });

    res.json({ conversation, messages });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Rename a conversation
// @route   PUT /api/conversations/:id
// @access  Private
export const renameConversation = async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { title },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a conversation and its messages
// @route   DELETE /api/conversations/:id
// @access  Private
export const deleteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Delete associated messages
    await Message.deleteMany({ conversationId: conversation._id });

    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Post a new message in a conversation (handles AI flow basics)
// @route   POST /api/chat
// @access  Private
export const handleChatMessage = async (req, res) => {
  try {
    const { conversationId, message: content, model } = req.body;

    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: req.user._id,
      });
    }

    // Create a new conversation if it doesn't exist yet
    if (!conversation) {
      conversation = await Conversation.create({
        userId: req.user._id,
        title: content.substring(0, 30) || 'New Conversation',
        modelUsed: model || 'grok',
      });
    }

    // 1. Save User Message
    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: 'user',
      content,
    });

    // 2. Fetch conversation history for context
    const previousMessages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 });
    const formattedHistory = previousMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // System instruction to extract Pexels query
    const messagesForGrok = [
      { 
        role: 'system', 
        content: `You are Refly, an AI assistant helping creators find stock media. Respond cheerfully and concisely to the user's request. 
IMPORTANT: You MUST append a 1-3 word search query at the very end of your response inside brackets like this: [QUERY: search terms here]. This query will be used to search the Pexels API.`
      },
      ...formattedHistory
    ];

    // Connect to Grok (x.ai)
    let aiContent = "I'm sorry, I couldn't connect to the AI service.";
    let searchQuery = content;

    try {
      const openai = new OpenAI({
        apiKey: process.env.GROK_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      });

      const completion = await openai.chat.completions.create({
        model: 'grok-2-latest',
        messages: messagesForGrok,
      });

      aiContent = completion.choices[0].message.content;

      // Extract the [QUERY: ...] part
      const queryRegex = /\[QUERY:\s*(.*?)\]/i;
      const match = aiContent.match(queryRegex);
      if (match && match[1]) {
        searchQuery = match[1].replace(/['"]/g, '').trim();
        aiContent = aiContent.replace(queryRegex, '').trim();
      }
    } catch (error) {
      console.error('Grok API Error:', error.message);
      aiContent = `Grok API Error: ${error.message}. Please ensure GROK_API_KEY is set.`;
    }

    // 3. Fetch Real Media (Pexels + YouTube)
    let mediaResults = [];
    
    // 3a. Search Pexels
    if (process.env.PEXELS_API_KEY) {
      try {
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=2`, {
          headers: {
            Authorization: process.env.PEXELS_API_KEY
          }
        });
        
        if (pexelsRes.data && pexelsRes.data.videos) {
          const pexelsVideos = pexelsRes.data.videos.map(video => ({
            id: video.id.toString(),
            title: `Stock Video: ${searchQuery}`,
            thumbnail: video.image,
            url: video.url,
            previewUrl: video.video_files[0]?.link || video.url,
            source: 'Pexels',
            author: video.user.name,
            type: 'video',
            license: 'Free to use',
          }));
          mediaResults = [...mediaResults, ...pexelsVideos];
        }
      } catch (err) {
        console.error('Pexels API Error:', err.message);
      }
    } else {
      console.warn('PEXELS_API_KEY is not set in environment variables.');
    }

    // 3b. Search YouTube
    try {
      const ytRes = await ytSearch(searchQuery);
      if (ytRes && ytRes.videos && ytRes.videos.length > 0) {
        // Take the top 2 YouTube videos
        const topYtVideos = ytRes.videos.slice(0, 2).map(video => ({
          id: video.videoId,
          title: video.title,
          thumbnail: video.thumbnail,
          url: video.url,
          previewUrl: video.url, // YouTube doesn't give raw mp4 for previews without scraping deeply, so we use the video url
          source: 'YouTube',
          author: video.author.name,
          type: 'video',
          license: 'Standard YouTube License',
        }));
        mediaResults = [...mediaResults, ...topYtVideos];
      }
    } catch (err) {
      console.error('YouTube Search Error:', err.message);
    }

    // 4. Save Assistant Message
    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: aiContent,
      mediaResults: mediaResults,
    });

    // Update conversation updatedAt timestamp
    conversation.updatedAt = new Date();
    await conversation.save();

    res.status(201).json({
      conversationId: conversation._id,
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
