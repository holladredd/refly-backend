import express from 'express';
import {
  createConversation,
  getConversations,
  getConversationById,
  renameConversation,
  deleteConversation,
  handleChatMessage,
} from '../controllers/conversationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

// Chat endpoint (POST /api/chat)
router.route('/chat')
  .post(handleChatMessage);

// Conversation endpoints (GET /api/conversations, POST /api/conversations)
router.route('/conversations')
  .post(createConversation)
  .get(getConversations);

// Single conversation endpoints (GET, PUT, DELETE /api/conversations/:id)
router.route('/conversations/:id')
  .get(getConversationById)
  .put(renameConversation)
  .delete(deleteConversation);

export default router;
