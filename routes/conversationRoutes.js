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

// Apply auth middleware to all routes here
router.use(protect);

router.route('/')
  .post(createConversation)
  .get(getConversations);

router.route('/chat')
  .post(handleChatMessage);

router.route('/:id')
  .get(getConversationById)
  .put(renameConversation)
  .delete(deleteConversation);

export default router;
