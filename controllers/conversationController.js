import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

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

    // 2. Generate/Simulate AI Response (Milestone 3 will integrate real APIs)
    // For now we mock the AI response + mock media extraction
    const mockKeywords = ['lagos', 'night', 'drone', 'city'];
    const aiContent = `Here are some media resources that might match your search for: "${content}". I've searched Pexels and Unsplash.`;
    const mockMediaResults = [
      {
        id: 'mock-1',
        title: 'Cinematic Drone Video',
        thumbnail: 'https://images.pexels.com/photos/3889843/pexels-photo-3889843.jpeg?auto=compress&cs=tinysrgb&w=400',
        url: 'https://www.pexels.com/video/drone-footage-of-a-green-forest-3889843/',
        previewUrl: 'https://www.pexels.com/video/drone-footage-of-a-green-forest-3889843/',
        source: 'Pexels',
        author: 'Taryn Elliott',
        type: 'video',
        license: 'Pexels License (Free)',
      }
    ];

    // 3. Save Assistant Message
    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: aiContent,
      mediaResults: mockMediaResults,
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
