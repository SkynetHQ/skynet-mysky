import { ChildHandshake, Connection, WindowMessenger } from "post-me";
import { SkynetClient } from "skynet-js";
import { removeAdjacentChars } from "skynet-mysky-utils";
import { hash } from "tweetnacl";

import { dictionary } from "../src/dictionary";

const uiSeedLoggedOut = document.getElementById("seed-logged-out")!;
const uiSeedSignIn = document.getElementById("seed-sign-in")!;
const uiSeedSignUp = document.getElementById("seed-sign-up")!;

const SEED_LENGTH = 13;
const CHECKSUM_LENGTH = 2;
const PHRASE_LENGTH = SEED_LENGTH + CHECKSUM_LENGTH;

let readySeed = "";
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

  const generatedSeed = generateSeed();
  (<HTMLInputElement>document.getElementById("signup-passphrase-text")).value = generatedSeed;

  uiSeedSignUp.style.display = "block";
};

(window as any).signIn = () => {
  const seedValue = (<HTMLInputElement>document.getElementById("signin-passphrase-text")).value;

  if (seedValue === "") {
    alert("Please enter a seed!");
    return;
  }
  const [valid, error] = validateSeed(seedValue);
  if (!valid) {
    alert(error);
    return;
  }

  handleSeed(seedValue);
};

(window as any).signUp = () => {
  const seedValue = (<HTMLInputElement>document.getElementById("signup-passphrase-text")).value;

  handleSeed(seedValue);
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
async function getRootSeed(): Promise<string> {
  const checkInterval = 100;

  return new Promise((resolve) => {
    const checkFunc = () => {
      if (readySeed !== "") {
        resolve(readySeed);
      }
    };

    window.setInterval(checkFunc, checkInterval);
  });
}

/**
 * @param seed
 */
function handleSeed(seed: string) {
  readySeed = seed;
}

/**
 * Generates a 15-word seed phrase for 16 bytes of entropy plus 20 bits of checksum. The dictionary length is 1024 which gives 10 bits of entropy per word.
 */
export function generatePhrase(): string {
  const seed = new Uint16Array(SEED_LENGTH);
  window.crypto.getRandomValues(seed);

  for (let i = 0; i < SEED_LENGTH; i++) {
    let numBits = 10;
    // For the 13th word, only the first 256 words are considered valid.
    if (i === 12) {
      numBits = 8;
    }
    seed[i] = seed[i] % (1 << numBits);
  }

  // Generate checksum from hash.
  const checksum = generateChecksum(seed);

  const words: string[] = new Array(PHRASE_LENGTH);
  for (let i = 0; i < SEED_LENGTH; i++) {
    words[i] = dictionary[seed[i]];
  }
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    words[i + SEED_LENGTH] = dictionary[checksum[i]];
  }

  return words.join(" ");
}

/**
 * Validate the seed by checking that for every word, there is a dictionary word that starts with the first 3 letters of the word. For the last three words of the phrase, only the first 256 words of the dictionary are considered valid.
 *
 * @param seed - The seed to check.
 * @returns - A boolean indicating whether the seed is valid, and a string explaining the error if it's not.
 */
export function validatePhrase(phrase: string): [boolean, string] {
  // Remove duplicate adjacent spaces.
  phrase = removeAdjacentChars(phrase.trim(), " ");
  const words = phrase.split(" ");
  if (words.length !== PHRASE_LENGTH) {
    return [false, `Phrase must be 15 words long, was ${words.length}`];
  }

  // Build the seed from words.
  let seed = new Uint16Array(13);
  let i = 0;
  for (const word of words) {
    // Check word length.
    if (word.length < 3) {
      return [false, `Word ${i + 1} is not at least 3 letters long`];
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
        return [false, `Prefix for word ${i + 1} must be found in the first 256 words of the dictionary`];
      } else {
        return [false, `Unrecognized prefix "${prefix}" at word ${i + 1}, not found in dictionary`];
      }
    }

    seed[i] = found;

    i++;
  }

  // Validate checksum.
  const checksum = generateChecksum(seed);
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    const prefix = dictionary[checksum[i]].slice(0,3);
    if (words[i + SEED_LENGTH].slice(0,3) !== prefix) {
      return [false, `Word "${words[i+SEED_LENGTH]}" is not a valid checksum for the seed, expected prefix ${prefix}`];
    }
  }

  return [true, ""];
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

function generateChecksum(seed: Uint16Array): Uint16Array {
  if (seed.length != SEED_LENGTH) {
    throw new Error(`Input seed was not of length ${SEED_LENGTH}`);
  }

  const entropy = seedToEntropy(seed);
  const h = hash(entropy);
  const checksum = hashToChecksum(h);

  return checksum;
}

function hashToChecksum(h: Uint8Array): Uint16Array {
  // We are getting 20 bits of checksum, stored in 2 numbers.
  const bytes = new Uint16Array(2);
  let curByte = 0;
  let curBit = 0;

  // Iterate over 20 bits of the hash.
  let numBits = 0;
  for (let i = 0; numBits < 20; i++) {
    const hashByte = h[i];

    // Iterate over the bits of the 8-bit hash byte.
    for (let j = 0; j < 8; j++) {
      const bitSet = (hashByte & (1 << (8 - j - 1))) > 0;

      if (bitSet) {
        bytes[curByte] |= 1 << (10 - curBit - 1);
      }

      curBit += 1;
      if (curBit >= 10) {
        curByte += 1;
        curBit = 0;
      }
      numBits++;
      if (numBits >= 20) break;
    }
  }

  return bytes;
}

function seedToEntropy(seed: Uint16Array): Uint8Array {
  if (seed.length != SEED_LENGTH) {
    throw new Error(`Input seed was not of length ${SEED_LENGTH}`);
  }

  // We are getting 16 bytes of entropy.
  const bytes = new Uint8Array(16);
  let curByte = 0;
  let curBit = 0;

  for (let i = 0; i < SEED_LENGTH; i++) {
    const wordNum = seed[i];
    let wordBits = 10;
    if (i === SEED_LENGTH - 1) {
      wordBits = 8;
    }

    // Iterate over the bits of the 10- or 8-bit word.
    for (let j = 0; j < wordBits; j++) {
      const bitSet = (wordNum & (1 << (wordBits - j - 1))) > 0;

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
