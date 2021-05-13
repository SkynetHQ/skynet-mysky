import { ChildHandshake, Connection, WindowMessenger } from "post-me";
import { SkynetClient } from "skynet-js";
import { removeAdjacentChars } from "skynet-mysky-utils";
import { hash } from "tweetnacl";

import { dictionary } from "../src/dictionary";
import { CHECKSUM_WORDS_LENGTH, PHRASE_LENGTH, SEED_LENGTH, SEED_WORDS_LENGTH } from "../src/seed";

const uiSeedLoggedOut = document.getElementById("seed-logged-out")!;
const uiSeedSignIn = document.getElementById("seed-sign-in")!;
const uiSeedSignUp = document.getElementById("seed-sign-up")!;

let readySeed: Uint8Array | null = null;
let parentConnection: Connection | null = null;

// ======
// Events
// ======

window.onerror = function (error: any) {
  console.log(error);
  if (parentConnection) {
    if (typeof error === "string") {
      parentConnection.remoteHandle().call("catchError", error);
    } else {
      parentConnection.remoteHandle().call("catchError", error.type);
    }
  }
};

// Code that runs on page load.
window.onload = async () => {
  await init();

  // Go to Logged Out page.

  (window as any).goToLoggedOut();
};

// ============
// User Actions
// ============

(window as any).goToLoggedOut = () => {
  setAllSeedContainersInvisible();
  uiSeedLoggedOut.style.display = "block";
};

(window as any).goToSignIn = () => {
  setAllSeedContainersInvisible();
  uiSeedSignIn.style.display = "block";
};

(window as any).goToSignUp = () => {
  setAllSeedContainersInvisible();

  const generatedPhrase = generatePhrase();
  (<HTMLInputElement>document.getElementById("signup-passphrase-text")).value = generatedPhrase;

  uiSeedSignUp.style.display = "block";
};

(window as any).signIn = () => {
  const phraseValue = (<HTMLInputElement>document.getElementById("signin-passphrase-text")).value;

  if (phraseValue === "") {
    alert("Please enter a phrase!");
    return;
  }
  const [valid, error, seed] = validatePhrase(phraseValue);
  if (!valid || !seed) {
    alert(error);
    return;
  }

  handleSeed(seed);
};

(window as any).signUp = () => {
  const phraseValue = (<HTMLInputElement>document.getElementById("signup-passphrase-text")).value;

  handleSeed(phraseToSeed(phraseValue));
};

// ==========
// Core Logic
// ==========

/**
 * Initialize the communication with the UI.
 */
async function init() {
  // Establish handshake with parent window.

  const messenger = new WindowMessenger({
    localWindow: window,
    remoteWindow: window.parent,
    remoteOrigin: "*",
  });
  const methods = {
    getRootSeed,
  };
  parentConnection = await ChildHandshake(messenger, methods);
}

/**
 * Called by MySky UI. Checks for the ready seed at an interval.
 */
async function getRootSeed(): Promise<Uint8Array> {
  const checkInterval = 100;

  return new Promise((resolve) => {
    const checkFunc = () => {
      if (readySeed !== null) {
        resolve(readySeed);
      }
    };

    window.setInterval(checkFunc, checkInterval);
  });
}

/**
 * @param seed
 * @param phrase
 */
function handleSeed(seed: Uint8Array) {
  readySeed = seed;
}

/**
 * Generates a 15-word seed phrase for 16 bytes of entropy plus 20 bits of checksum. The dictionary length is 1024 which gives 10 bits of entropy per word.
 */
export function generatePhrase(): string {
  const seedWords = new Uint16Array(SEED_WORDS_LENGTH);
  window.crypto.getRandomValues(seedWords);

  // Populate the seed words from the random values.
  for (let i = 0; i < SEED_WORDS_LENGTH; i++) {
    let numBits = 10;
    // For the 13th word, only the first 256 words are considered valid.
    if (i === 12) {
      numBits = 8;
    }
    seedWords[i] = seedWords[i] % (1 << numBits);
  }

  // Generate checksum from hash of the seed.
  const checksumWords = generateChecksumWordsFromSeedWords(seedWords);

  const phraseWords: string[] = new Array(PHRASE_LENGTH);
  for (let i = 0; i < SEED_WORDS_LENGTH; i++) {
    phraseWords[i] = dictionary[seedWords[i]];
  }
  for (let i = 0; i < CHECKSUM_WORDS_LENGTH; i++) {
    phraseWords[i + SEED_WORDS_LENGTH] = dictionary[checksumWords[i]];
  }

  return phraseWords.join(" ");
}

/**
 * Validate the phrase by checking that for every word, there is a dictionary word that starts with the first 3 letters of the word. For the last word of the seed phrase (the 12th word), only the first 256 words of the dictionary are considered valid.
 *
 * @param phrase - The phrase to check.
 * @returns - A boolean indicating whether the phrase is valid, and a string explaining the error if it's not.
 */
export function validatePhrase(phrase: string): [boolean, string, Uint8Array | null] {
  phrase = sanitizePhrase(phrase);
  const phraseWords = phrase.split(" ");
  if (phraseWords.length !== PHRASE_LENGTH) {
    return [false, `Phrase must be 15 words long, was ${phraseWords.length}`, null];
  }

  // Build the seed from words.
  const seedWords = new Uint16Array(SEED_WORDS_LENGTH);
  let i = 0;
  for (const word of phraseWords) {
    // Check word length.
    if (word.length < 3) {
      return [false, `Word ${i + 1} is not at least 3 letters long`, null];
    }

    // Check word prefix.
    const prefix = word.slice(0, 3);
    let bound = dictionary.length;
    if (i === 12) {
      bound = 256;
    }
    let found = -1;
    for (let j = 0; j < bound; j++) {
      const curPrefix = dictionary[j].slice(0, 3);
      if (curPrefix === prefix) {
        found = j;
        break;
      } else if (curPrefix > prefix) {
        break;
      }
    }
    if (found < 0) {
      if (i === 12) {
        return [false, `Prefix for word ${i + 1} must be found in the first 256 words of the dictionary`, null];
      } else {
        return [false, `Unrecognized prefix "${prefix}" at word ${i + 1}, not found in dictionary`, null];
      }
    }

    seedWords[i] = found;

    i++;
  }

  // Validate checksum.
  const checksumWords = generateChecksumWordsFromSeedWords(seedWords);
  for (let i = 0; i < CHECKSUM_WORDS_LENGTH; i++) {
    const prefix = dictionary[checksumWords[i]].slice(0, 3);
    if (phraseWords[i + SEED_WORDS_LENGTH].slice(0, 3) !== prefix) {
      return [false, `Word "${phraseWords[i + SEED_WORDS_LENGTH]}" is not a valid checksum for the seed`, null];
    }
  }

  return [true, "", seedWordsToSeed(seedWords)];
}

// ================
// Helper Functions
// ================

/**
 *
 */
function setAllSeedContainersInvisible() {
  uiSeedLoggedOut.style.display = "none";
  uiSeedSignIn.style.display = "none";
  uiSeedSignUp.style.display = "none";
}

/**
 * @param seedWords
 */
function generateChecksumWordsFromSeedWords(seedWords: Uint16Array): Uint16Array {
  if (seedWords.length != SEED_WORDS_LENGTH) {
    throw new Error(`Input seed was not of length ${SEED_WORDS_LENGTH}`);
  }

  const seed = seedWordsToSeed(seedWords);
  const h = hash(seed);
  const checksumWords = hashToChecksumWords(h);

  return checksumWords;
}

/**
 * @param h
 */
export function hashToChecksumWords(h: Uint8Array): Uint16Array {
  let word1 = h[0] << 8;
  word1 += h[1];
  word1 >>= 6;
  let word2 = h[1] << 10;
  word2 &= 0xffff;
  word2 += h[2] << 2;
  word2 >>= 6;
  return new Uint16Array([word1, word2]);
}

/**
 * @param seedWords
 */
export function seedWordsToSeed(seedWords: Uint16Array): Uint8Array {
  if (seedWords.length != SEED_WORDS_LENGTH) {
    throw new Error(`Input seed was not of length ${SEED_WORDS_LENGTH}`);
  }

  // We are getting 16 bytes of entropy.
  const bytes = new Uint8Array(SEED_LENGTH);
  let curByte = 0;
  let curBit = 0;

  for (let i = 0; i < SEED_WORDS_LENGTH; i++) {
    const word = seedWords[i];
    let wordBits = 10;
    if (i === SEED_WORDS_LENGTH - 1) {
      wordBits = 8;
    }

    // Iterate over the bits of the 10- or 8-bit word.
    for (let j = 0; j < wordBits; j++) {
      const bitSet = (word & (1 << (wordBits - j - 1))) > 0;

      if (bitSet) {
        bytes[curByte] |= 1 << (8 - curBit - 1);
      }

      curBit += 1;
      if (curBit >= 8) {
        curByte += 1;
        curBit = 0;
      }
    }
  }

  return bytes;
}

/**
 * @param phrase
 */
function sanitizePhrase(phrase: string): string {
  // Remove duplicate adjacent spaces.
  return removeAdjacentChars(phrase.trim().toLowerCase(), " ");
}

/**
 * @param phrase
 */
function phraseToSeed(phrase: string): Uint8Array {
  phrase = sanitizePhrase(phrase);
  const [valid, error, seed] = validatePhrase(phrase);
  if (!valid || !seed) {
    throw new Error(error);
  }

  return seed;
}
