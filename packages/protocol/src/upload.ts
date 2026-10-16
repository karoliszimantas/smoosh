// what the picture upload endpoint answers when it refuses one — shared so
// the client's dev tools can fake a refusal word for word
export const UPLOAD_MESSAGES = {
  too_late: 'Too late — the pictures were already being shown, so yours was not included this round',
  wrong_phase: 'Not accepting pictures for that round',
  too_large: 'file too large (max 5MB)',
  wrong_type: 'expected a WebP, JPEG or PNG image',
  room_not_found: 'room not found',
  not_owner: 'session does not own this player',
  failed: 'upload failed',
} as const

// the query flag a client adds to a picture upload when nothing is on it —
// the server skips that picture's Lie and Guess (it also checks the pixels)
export const BLANK_PICTURE_PARAM = 'blank'
