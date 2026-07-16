import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import OpenAI from "openai";
import axios from "axios";
import ytSearch from "yt-search";

// @desc    Create new conversation
// @route   POST /api/conversations
// @access  Private
export const createConversation = async (req, res) => {
  try {
    const { title, modelUsed } = req.body;
    const conversation = await Conversation.create({
      userId: req.user._id,
      title: title || "New Conversation",
      modelUsed: modelUsed || "grok",
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
    const conversations = await Conversation.find({
      userId: req.user._id,
    }).sort({ updatedAt: -1 });
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
      return res.status(404).json({ message: "Conversation not found" });
    }

    const messages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

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
      { new: true },
    );

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
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
      return res.status(404).json({ message: "Conversation not found" });
    }

    // Delete associated messages
    await Message.deleteMany({ conversationId: conversation._id });

    res.json({ message: "Conversation deleted successfully" });
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
        title: content.substring(0, 30) || "New Conversation",
        modelUsed: model || "grok",
      });
    }

    // 1. Save User Message
    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: "user",
      content,
    });

    // 2. Fetch conversation history for context
    const previousMessages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });
    const formattedHistory = previousMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // System instruction to extract Pexels query
    const messagesForGrok = [
      {
        role: "system",
        content: `You are Refly, an AI assistant helping creators find stock media. Respond cheerfully and concisely to the user's request. 
IMPORTANT: You MUST append a 1-3 word search query at the very end of your response inside brackets like this: [QUERY: search terms here]. This query will be used to search the Pexels API.`,
      },
      ...formattedHistory,
    ];

    // Connect to Grok (x.ai)
    let aiContent = "I'm sorry, I couldn't connect to the AI service.";
    let searchQuery = content;

    try {
      const selectedModel = req.body.model || "grok-4.5";
      // Route to the correct API key based on model version
      const apiKey = selectedModel.startsWith("grok-4")
        ? process.env.GROK_API_KEY_V4 || process.env.GROK_API_KEY
        : process.env.GROK_API_KEY;

      const openai = new OpenAI({
        apiKey,
        baseURL: "https://api.x.ai/v1",
      });

      const completion = await openai.chat.completions.create({
        model: selectedModel,
        messages: messagesForGrok,
      });

      aiContent = completion.choices[0].message.content;

      // Extract the [QUERY: ...] part
      const queryRegex = /\[QUERY:\s*(.*?)\]/i;
      const match = aiContent.match(queryRegex);
      if (match && match[1]) {
        searchQuery = match[1].replace(/['"]/g, "").trim();
        aiContent = aiContent.replace(queryRegex, "").trim();
      }
    } catch (error) {
      console.error("Grok API Error:", error.message);
      aiContent = `Grok API Error: ${error.message}. Please ensure GROK_API_KEY is set.`;
    }

    // 3. Fetch Real Media (Pexels + YouTube)
    let mediaResults = [];

    // 3a. Search Pexels Videos
    if (process.env.PEXELS_API_KEY) {
      try {
        const pexelsRes = await axios.get(
          `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=15`,
          {
            headers: {
              Authorization: process.env.PEXELS_API_KEY,
            },
          },
        );

        if (pexelsRes.data && pexelsRes.data.videos) {
          const pexelsVideos = pexelsRes.data.videos.map((video) => ({
            id: `px-v-${video.id}`,
            title: `Stock Video: ${searchQuery}`,
            thumbnail: video.image,
            url: video.url,
            previewUrl: video.video_files[0]?.link || video.url,
            source: "Pexels",
            author: video.user.name,
            type: "video",
            license: "Free to use",
          }));
          mediaResults = [...mediaResults, ...pexelsVideos];
        }

        // Search Pexels Images
        const pexelsImgRes = await axios.get(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=15`,
          {
            headers: {
              Authorization: process.env.PEXELS_API_KEY,
            },
          },
        );

        if (pexelsImgRes.data && pexelsImgRes.data.photos) {
          const pexelsImages = pexelsImgRes.data.photos.map((photo) => ({
            id: `px-i-${photo.id}`,
            title: `Stock Photo: ${searchQuery}`,
            thumbnail: photo.src.medium,
            url: photo.url,
            previewUrl: photo.src.large,
            source: "Pexels",
            author: photo.photographer,
            type: "image",
            license: "Free to use",
          }));
          mediaResults = [...mediaResults, ...pexelsImages];
        }
      } catch (err) {
        console.error("Pexels API Error:", err.message);
      }
    } else {
      console.warn("PEXELS_API_KEY is not set in environment variables.");
    }

    // 3b. Search YouTube
    try {
      const ytRes = await ytSearch(searchQuery);
      if (ytRes && ytRes.videos && ytRes.videos.length > 0) {
        const topYtVideos = ytRes.videos.slice(0, 10).map((video) => ({
          id: `yt-${video.videoId}`,
          title: video.title,
          thumbnail: video.thumbnail,
          url: video.url,
          previewUrl: video.url,
          source: "YouTube",
          author: video.author.name,
          duration: video.duration?.timestamp || null,
          views: video.views || null,
          type: "video",
          license: "Standard YouTube License",
        }));
        mediaResults = [...mediaResults, ...topYtVideos];
      }
    } catch (err) {
      console.error("YouTube Search Error:", err.message);
    }

    // 3c. Search Vimeo (free, no key needed via public oembed)
    try {
      const vimeoRes = await axios.get(
        `https://api.vimeo.com/videos?query=${encodeURIComponent(searchQuery)}&per_page=5&filter=CC`,
        {
          headers: {
            Authorization: `bearer ${process.env.VIMEO_ACCESS_TOKEN || ""}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (vimeoRes.data && vimeoRes.data.data) {
        const vimeoVideos = vimeoRes.data.data.map((v) => ({
          id: `vm-${v.uri.replace("/videos/", "")}`,
          title: v.name,
          thumbnail:
            v.pictures?.sizes?.[3]?.link || v.pictures?.sizes?.[0]?.link,
          url: v.link,
          previewUrl: v.link,
          source: "Vimeo",
          author: v.user?.name || "Vimeo Creator",
          type: "video",
          license: "Creative Commons",
        }));
        mediaResults = [...mediaResults, ...vimeoVideos];
      }
    } catch (err) {
      // Vimeo is optional — silently skip if token not configured
      if (err.response?.status !== 401)
        console.error("Vimeo Search Error:", err.message);
    }

    // 3d. Search Dailymotion (free public API, no key needed)
    try {
      const dmRes = await axios.get(
        `https://api.dailymotion.com/videos?search=${encodeURIComponent(searchQuery)}&limit=5&fields=id,title,thumbnail_480_url,url,owner.screenname,duration`,
      );
      if (dmRes.data && dmRes.data.list) {
        const dmVideos = dmRes.data.list.map((v) => ({
          id: `dm-${v.id}`,
          title: v.title,
          thumbnail: v.thumbnail_480_url,
          url: v.url || `https://www.dailymotion.com/video/${v.id}`,
          previewUrl: v.url || `https://www.dailymotion.com/video/${v.id}`,
          source: "Dailymotion",
          author: v["owner.screenname"] || "Dailymotion Creator",
          type: "video",
          license: "Standard License",
        }));
        mediaResults = [...mediaResults, ...dmVideos];
      }
    } catch (err) {
      console.error("Dailymotion Search Error:", err.message);
    }

    // Randomize the mediaResults array so it's a mix of sources
    mediaResults = mediaResults.sort(() => Math.random() - 0.5);

    // 3e. Use Grok to generate a short description/summary for each media item
    // so users know what each piece of content is about before clicking
    if (mediaResults.length > 0 && process.env.GROK_API_KEY) {
      try {
        const openaiForSummary = new OpenAI({
          apiKey: process.env.GROK_API_KEY_V4 || process.env.GROK_API_KEY,
          baseURL: "https://api.x.ai/v1",
        });
        const summaryPrompt = mediaResults.map(
          (m, i) =>
            `${i + 1}. [${m.source}] ${m.title} by ${m.author || "Unknown"}`,
        );
        const summaryCompletion =
          await openaiForSummary.chat.completions.create({
            model: "grok-4.5",
            messages: [
              {
                role: "system",
                content: `You are a media research assistant. For each of the following media items, provide a single concise sentence (max 20 words) that: 1) describes what the content shows, and 2) how a content creator could USE it (e.g., as a B-roll, thumbnail, intro clip, reference, etc). Return ONLY a JSON array of strings, one per item, in the same order. No extra text.`,
              },
              {
                role: "user",
                content: `Topic: "${searchQuery}"\n\nMedia items:\n${summaryPrompt.join("\n")}`,
              },
            ],
          });

        const rawSummary = summaryCompletion.choices[0].message.content.trim();

        // Extract just the array part to avoid JSON.parse errors from conversational filler
        const match = rawSummary.match(/\[[\s\S]*\]/);
        const cleanSummary = match ? match[0] : "[]";

        const descriptions = JSON.parse(cleanSummary);

        if (Array.isArray(descriptions)) {
          mediaResults = mediaResults.map((m, i) => ({
            ...m,
            description: descriptions[i] || null,
          }));
        }
      } catch (err) {
        console.error("Media summary generation error:", err.message);
        // Non-critical: descriptions simply won't appear
      }
    }

    // 4. Save Assistant Message
    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: aiContent,
      mediaResults: mediaResults,
      modelUsed: req.body.model || "grok-4.5",
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

// @desc    Edit/Resend a message
// @route   POST /api/chat/edit
// @access  Private
export const editChatMessage = async (req, res) => {
  try {
    const { conversationId, messageId, content, model } = req.body;

    const targetMessage = await Message.findOne({
      _id: messageId,
      conversationId,
    });
    if (!targetMessage) {
      return res.status(404).json({ message: "Target message not found" });
    }

    // Delete the target message and all messages that came after it in this conversation
    await Message.deleteMany({
      conversationId,
      createdAt: { $gte: targetMessage.createdAt },
    });

    // Now simply forward the modified request to handleChatMessage
    // which will act as if the user just sent this new content at this point in the timeline
    req.body.message = content;
    return handleChatMessage(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
