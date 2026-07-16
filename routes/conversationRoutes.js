import express from 'express';
import {
  createConversation,
  getConversations,
  getConversationById,
  renameConversation,
  deleteConversation,
  handleChatMessage,
  editChatMessage,
} from '../controllers/conversationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.route('/chat')
  .post(handleChatMessage);

router.route('/chat/edit')
  .post(editChatMessage);

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
