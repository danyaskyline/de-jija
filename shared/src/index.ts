/**
 * Shared protocol types between the game server and the client.
 *
 * Walking skeleton stage: only the ping/pong heartbeat exists, so that we can
 * prove the transport works. No game protocol (movement, battles) here yet.
 */

/** Sent by the client to check that the connection is alive. */
export type PingMessage = {
  type: 'ping';
  /** Client clock (Date.now()) at the moment the message was created. */
  timestamp: number;
};

/** Sent by the server in reply to a PingMessage. */
export type PongMessage = {
  type: 'pong';
  /** Echo of the client timestamp, so the client can measure round-trip time. */
  timestamp: number;
  /** Server clock (Date.now()) at the moment the reply was produced. */
  serverTime: number;
};

/** Everything the client is allowed to send to the server (grows later). */
export type ClientMessage = PingMessage;

/** Everything the server is allowed to send to the client (grows later). */
export type ServerMessage = PongMessage;
