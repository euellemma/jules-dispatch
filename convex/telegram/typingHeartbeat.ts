/**
 * TYPING HEARTBEAT - DISABLED
 * 
 * This file has been deprecated. The typing indicator is now only sent once
 * at the start of message processing in processMessageQueue. The self-draining
 * queue model eliminates the need for a continuous heartbeat since there's no
 * long-running agent state to track.
 * 
 * The initial typing indicator is sent in convex/api/telegram.ts in the
 * processMessageQueue function before processing begins.
 */

// Placeholder to maintain file structure - exports removed
export {};
