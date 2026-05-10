/**
 * @typedef {Object} TimedLyricLine
 * @property {number} startMs
 * @property {number | undefined} endMs
 * @property {string} text
 */

/**
 * @typedef {Object} LyricsPayload
 * @property {string} source
 * @property {TimedLyricLine[]} lines
 * @property {string=} plainLyrics
 */
