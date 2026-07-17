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

// ─── Helper: fetch media results for a search query ───────────────────────────
async function fetchMediaResults(searchQuery) {
  let mediaResults = [];

  // Pexels Videos
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexelsRes = await axios.get(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=10`,
        { headers: { Authorization: process.env.PEXELS_API_KEY } },
      );
      if (pexelsRes.data?.videos) {
        mediaResults.push(
          ...pexelsRes.data.videos.map((video) => ({
            id: `px-v-${video.id}`,
            title: video.url?.split("/").filter(Boolean).pop()?.replace(/-/g, " ") || `Stock Video: ${searchQuery}`,
            thumbnail: video.image,
            url: video.url,
            previewUrl: video.video_files[0]?.link || video.url,
            source: "Pexels",
            author: video.user.name,
            type: "video",
            license: "Free to use",
          })),
        );
      }

      // Pexels Images
      const pexelsImgRes = await axios.get(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=10`,
        { headers: { Authorization: process.env.PEXELS_API_KEY } },
      );
      if (pexelsImgRes.data?.photos) {
        mediaResults.push(
          ...pexelsImgRes.data.photos.map((photo) => ({
            id: `px-i-${photo.id}`,
            title: photo.alt || `Stock Photo: ${searchQuery}`,
            thumbnail: photo.src.medium,
            url: photo.url,
            previewUrl: photo.src.large,
            source: "Pexels",
            author: photo.photographer,
            type: "image",
            license: "Free to use",
          })),
        );
      }
    } catch (err) {
      console.error("Pexels API Error:", err.message);
    }
  }

  // Dailymotion
  try {
    const dmRes = await axios.get(
      `https://api.dailymotion.com/videos?search=${encodeURIComponent(searchQuery)}&limit=5&fields=id,title,thumbnail_480_url,url,owner.screenname,duration`,
    );
    if (dmRes.data?.list) {
      mediaResults.push(
        ...dmRes.data.list.map((v) => ({
          id: `dm-${v.id}`,
          title: v.title,
          thumbnail: v.thumbnail_480_url,
          url: v.url || `https://www.dailymotion.com/video/${v.id}`,
          previewUrl: v.url || `https://www.dailymotion.com/video/${v.id}`,
          source: "Dailymotion",
          author: v["owner.screenname"] || "Dailymotion Creator",
          type: "video",
          license: "Standard License",
        })),
      );
    }
  } catch (err) {
    console.error("Dailymotion Search Error:", err.message);
  }

  // YouTube
  try {
    const ytRes = await ytSearch(searchQuery);
    if (ytRes?.videos?.length > 0) {
      mediaResults.push(
        ...ytRes.videos.slice(0, 8).map((video) => ({
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
        })),
      );
    }
  } catch (err) {
    console.error("YouTube Search Error:", err.message);
  }

  // Randomize and limit to 10 for description enrichment performance
  return mediaResults.sort(() => Math.random() - 0.5).slice(0, 10);
}

// ─── Helper: generate per-item description + usage tip via Grok ───────────────
async function enrichWithDescriptions(mediaResults, searchQuery) {
  if (!mediaResults.length || !process.env.GROK_API_KEY) return mediaResults;

  try {
    // Always use the stable working key for descriptions, never V4
    const openaiForSummary = new OpenAI({
      apiKey: process.env.GROK_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });

    const itemList = mediaResults
      .map(
        (m, i) =>
          `${i + 1}. [${m.type.toUpperCase()}] "${m.title}" by ${m.author || "Unknown"} (Source: ${m.source})`,
      )
      .join("\n");

    const summaryCompletion = await openaiForSummary.chat.completions.create({
      model: "grok-2-1212", // stable model available on standard key tier
      messages: [
        {
          role: "system",
          content: `You are a media research assistant for content creators. 
For each media item listed below, provide a short JSON object with two fields:
- "desc": one sentence (max 18 words) describing what the content visually shows
- "usage": one sentence (max 18 words) on how a content creator can use it (e.g., B-roll, thumbnail, intro clip, background)

Return ONLY a valid JSON array of these objects, one per item in the same order. No extra text outside the array.`,
        },
        {
          role: "user",
          content: `Topic: "${searchQuery}"\n\nMedia items:\n${itemList}`,
        },
      ],
    });

    const raw = summaryCompletion.choices[0].message.content.trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return mediaResults;

    const parsed = JSON.parse(match[0]);

    if (Array.isArray(parsed)) {
      return mediaResults.map((m, i) => ({
        ...m,
        description: parsed[i]?.desc || null,
        usageTip: parsed[i]?.usage || null,
      }));
    }
  } catch (err) {
    console.error("Media description error:", err.status, err.message);
    // Non-critical — return media without descriptions rather than failing
  }

  return mediaResults;
}

// @desc    Post a new message — STREAMING SSE response
// @route   POST /api/chat/stream
// @access  Private
export const handleChatStream = async (req, res) => {
  const { conversationId, message: content, model } = req.body;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering on Render
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: req.user._id,
      });
    }
    if (!conversation) {
      conversation = await Conversation.create({
        userId: req.user._id,
        title: content.substring(0, 40) || "New Conversation",
        modelUsed: model || "grok",
      });
      // Notify client about the new conversation ID
      send("conversation", { conversationId: conversation._id });
    }

    // Save user message
    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: "user",
      content,
    });
    send("user_message", userMessage);

    // Build conversation history for context
    const previousMessages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    const formattedHistory = previousMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const messagesForGrok = [
      {
        role: "system",
        content: `You are Refly, an AI research assistant helping creators find stock media. 
Give a helpful, informative response about the user's topic. 
IMPORTANT: At the very end of your response, append a 1-4 word search query inside brackets: [QUERY: search terms]. This will be used to search media APIs.`,
      },
      ...formattedHistory,
    ];

    // Pick API key and actual model name based on selection
    const selectedModel = model || "grok-4";
    let apiKey, apiModel;
    if (selectedModel === "grok-4.5") {
      apiKey = process.env.GROK_API_KEY_V4 || process.env.GROK_API_KEY;
      apiModel = "grok-4.5";
    } else {
      // Default "grok-4" routes to standard key with grok-2-1212
      apiKey = process.env.GROK_API_KEY;
      apiModel = "grok-2-1212";
    }

    const openai = new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });

    // ── STREAM the AI text ──
    let fullAiContent = "";
    let searchQuery = content;

    try {
      const stream = await openai.chat.completions.create({
        model: apiModel,
        messages: messagesForGrok,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          fullAiContent += delta;
          send("chunk", { text: delta });
        }
      }

      // Extract [QUERY: ...] from the completed text
      const queryRegex = /\[QUERY:\s*(.*?)\]/i;
      const queryMatch = fullAiContent.match(queryRegex);
      if (queryMatch?.[1]) {
        searchQuery = queryMatch[1].replace(/['"]/g, "").trim();
        fullAiContent = fullAiContent.replace(queryRegex, "").trim();
      }
    } catch (err) {
      console.error("Grok Stream Error:", err.message);
      const errMsg = `I encountered an issue connecting to the AI (${err.message}). Here are some relevant media results for your query.`;
      fullAiContent = errMsg;
      send("chunk", { text: errMsg });
    }

    // ── Fetch media ──
    send("status", { message: "Finding media resources..." });
    let mediaResults = await fetchMediaResults(searchQuery);

    // ── Enrich with descriptions ──
    send("status", { message: "Generating descriptions..." });
    mediaResults = await enrichWithDescriptions(mediaResults, searchQuery);

    // ── Save assistant message ──
    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: fullAiContent,
      mediaResults,
      modelUsed: selectedModel,
    });

    conversation.updatedAt = new Date();
    await conversation.save();

    // ── Send final "done" event with saved messages ──
    send("done", {
      conversationId: conversation._id,
      userMessage,
      assistantMessage,
    });

    res.end();
  } catch (error) {
    console.error("Stream handler error:", error.message);
    send("error", { message: error.message });
    res.end();
  }
};

// @desc    Post a new message (non-streaming fallback)
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
    if (!conversation) {
      conversation = await Conversation.create({
        userId: req.user._id,
        title: content.substring(0, 40) || "New Conversation",
        modelUsed: model || "grok",
      });
    }

    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: "user",
      content,
    });

    const previousMessages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    const formattedHistory = previousMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const messagesForGrok = [
      {
        role: "system",
        content: `You are Refly, an AI research assistant helping creators find stock media. Give a helpful response and append [QUERY: search terms] at the end.`,
      },
      ...formattedHistory,
    ];

    let aiContent = "I'm sorry, I couldn't connect to the AI service.";
    let searchQuery = content;

    try {
      const selectedModel = model || "grok-4";
      let apiKey, apiModel;
      if (selectedModel === "grok-4.5") {
        apiKey = process.env.GROK_API_KEY_V4 || process.env.GROK_API_KEY;
        apiModel = "grok-4.5";
      } else {
        apiKey = process.env.GROK_API_KEY;
        apiModel = "grok-2-1212";
      }

      const openai = new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });
      const completion = await openai.chat.completions.create({
        model: apiModel,
        messages: messagesForGrok,
      });

      aiContent = completion.choices[0].message.content;
      const queryRegex = /\[QUERY:\s*(.*?)\]/i;
      const match = aiContent.match(queryRegex);
      if (match?.[1]) {
        searchQuery = match[1].replace(/['"]/g, "").trim();
        aiContent = aiContent.replace(queryRegex, "").trim();
      }
    } catch (error) {
      console.error("Grok API Error:", error.status, error.message);
      aiContent = "I'm having trouble connecting to the AI right now. Here are some relevant media results for you.";
    }

    let mediaResults = await fetchMediaResults(searchQuery);
    mediaResults = await enrichWithDescriptions(mediaResults, searchQuery);

    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: aiContent,
      mediaResults,
      modelUsed: model || "grok-4",
    });

    conversation.updatedAt = new Date();
    await conversation.save();

    res.status(201).json({ conversationId: conversation._id, userMessage, assistantMessage });
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

    const targetMessage = await Message.findOne({ _id: messageId, conversationId });
    if (!targetMessage) {
      return res.status(404).json({ message: "Target message not found" });
    }

    await Message.deleteMany({
      conversationId,
      createdAt: { $gte: targetMessage.createdAt },
    });

    req.body.message = content;
    return handleChatMessage(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
