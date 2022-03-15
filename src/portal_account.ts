import { KeyPair, SkynetClient } from "skynet-js";
import type { CustomClientOptions } from "skynet-js";
import { ensureUrl, trimSuffix } from "skynet-mysky-utils";
import { sign } from "tweetnacl";

import { genKeyPairFromHash, hashWithSalt } from "./crypto";
import { hexToUint8Array, stringToUint8ArrayUtf8, toHexString, validateHexString, validateUint8ArrayLen } from "./util";

export const PORTAL_ACCOUNT_PAGE_SUBDOMAIN = "account";

/**
 * The size of the expected signature.
 */
const CHALLENGE_SIGNATURE_SIZE = sign.signatureLength;
/**
 * The number of bytes of entropy to send as a challenge.
 */
const CHALLENGE_SIZE = 32;
/**
 * The type of the login challenge.
 */
const CHALLENGE_TYPE_LOGIN = "skynet-portal-login";
/**
 * The type of the registration challenge.
 */
const CHALLENGE_TYPE_REGISTER = "skynet-portal-register";

/**
 * Custom get user options.
 *
 * @property [endpointGetUser] - The relative URL path of the portal endpoint to contact.
 */
export type CustomGetUserOptions = CustomClientOptions & {
  endpointGetUser?: string;
};

/**
 * Custom register user pubkey options.
 *
 * @property [endpointRegisterUserPubkey] - The relative URL path of the portal endpoint to contact.
 */
export type CustomRegisterUserPubkeyOptions = CustomClientOptions & {
  endpointRegisterUserPubkey?: string;
};

/**
 * Custom register options.
 *
 * @property [endpointRegister] - The relative URL path of the portal endpoint to contact.
 */
export type CustomRegisterOptions = CustomClientOptions & {
  endpointRegister?: string;
};

/**
 * Custom login options.
 *
 * @property [endpointLogin] - The relative URL path of the portal endpoint to contact.
 */
export type CustomLoginOptions = CustomClientOptions & {
  endpointLogin?: string;
};

/**
 * Custom logout options.
 *
 * @property [endpointLogout] - The relative URL path of the portal endpoint to contact.
 */
export type CustomLogoutOptions = CustomClientOptions & {
  endpointLogout?: string;
};

/**
 * The default custom client options.
 */
const DEFAULT_CUSTOM_CLIENT_OPTIONS = {
  APIKey: "",
  customUserAgent: "",
  customCookie: "",
  onDownloadProgress: undefined,
  onUploadProgress: undefined,
};

export const DEFAULT_GET_USER_OPTIONS = {
  ...DEFAULT_CUSTOM_CLIENT_OPTIONS,

  endpointGetUser: "/api/user",
};

export const DEFAULT_REGISTER_USER_PUBKEY_OPTIONS = {
  ...DEFAULT_CUSTOM_CLIENT_OPTIONS,

  endpointRegisterUserPubkey: "/api/user/pubkey/register",
};

export const DEFAULT_REGISTER_OPTIONS = {
  ...DEFAULT_CUSTOM_CLIENT_OPTIONS,

  endpointRegister: "/api/register",
};

export const DEFAULT_LOGIN_OPTIONS = {
  ...DEFAULT_CUSTOM_CLIENT_OPTIONS,

  endpointLogin: "/api/login",
};

export const DEFAULT_LOGOUT_OPTIONS = {
  ...DEFAULT_CUSTOM_CLIENT_OPTIONS,

  endpointLogout: "/api/logout",
};

/**
 * The challenge response.
 *
 * @property response - The hex-encoded byte array of the signed data, e.g. challenge+type+recipient. The type is either
 * `skynet-portal-login` or `skynet-portal-register`, depending on the endpoint on which the challenge was requested.
 * @property signature - The signature of the data.
 */
type ChallengeResponse = {
  response: string;
  signature: string;
};

// ===
// API
// ===

/**
 * Gets whether the user is logged in.
 *
 * @param client - The Skynet client.
 * @param [customOptions] - The custom get user options.
 * @returns - Whether the user is logged in.
 */
export async function getUserLoggedIn(client: SkynetClient, customOptions?: CustomGetUserOptions): Promise<boolean> {
  const opts = { ...DEFAULT_GET_USER_OPTIONS, ...client.customOptions, ...customOptions };

  try {
    await client.executeRequest({
      endpointPath: opts.endpointGetUser,
      method: "GET",
      subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    });

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Registers a pubkey for the user for the given seed and tweak.
 *
 * @param client - The Skynet client.
 * @param seed - The seed.
 * @param tweak - The portal account tweak.
 * @param [customOptions] - The custom register user options.
 * @returns - An empty promise.
 */
export async function registerUserPubkey(
  client: SkynetClient,
  seed: Uint8Array,
  tweak: string,
  customOptions?: CustomRegisterUserPubkeyOptions
): Promise<void> {
  const opts = { ...DEFAULT_REGISTER_USER_PUBKEY_OPTIONS, ...client.customOptions, ...customOptions };

  const { publicKey, privateKey } = genPortalLoginKeypair(seed, tweak);

  const registerRequestResponse = await client.executeRequest({
    endpointPath: opts.endpointRegisterUserPubkey,
    method: "GET",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    query: { pubKey: publicKey },
  });

  const challenge = registerRequestResponse.data.challenge;
  const portalRecipient = getPortalRecipient(await client.portalUrl());
  const challengeResponse = signChallenge(privateKey, challenge, CHALLENGE_TYPE_REGISTER, portalRecipient);

  const data = {
    response: challengeResponse.response,
    signature: challengeResponse.signature,
  };
  await client.executeRequest({
    endpointPath: opts.endpointRegisterUserPubkey,
    method: "POST",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    data,
  });
}

/**
 * Registers a user for the given seed and tweak.
 *
 * @param client - The Skynet client.
 * @param seed - The seed.
 * @param email - The user email.
 * @param tweak - The portal account tweak.
 * @param [customOptions] - The custom register options.
 * @returns - An empty promise.
 */
export async function register(
  client: SkynetClient,
  seed: Uint8Array,
  email: string,
  tweak: string,
  customOptions?: CustomRegisterOptions
): Promise<void> {
  const opts = { ...DEFAULT_REGISTER_OPTIONS, ...client.customOptions, ...customOptions };

  const { publicKey, privateKey } = genPortalLoginKeypair(seed, tweak);

  const registerRequestResponse = await client.executeRequest({
    endpointPath: opts.endpointRegister,
    method: "GET",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    query: { pubKey: publicKey },
  });

  const challenge = registerRequestResponse.data.challenge;
  const portalRecipient = getPortalRecipient(await client.portalUrl());
  const challengeResponse = signChallenge(privateKey, challenge, CHALLENGE_TYPE_REGISTER, portalRecipient);

  const data = {
    response: challengeResponse.response,
    signature: challengeResponse.signature,
    email,
  };
  await client.executeRequest({
    endpointPath: opts.endpointRegister,
    method: "POST",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    data,
  });
}

/**
 * Logs in a user for the given seed and tweak.
 *
 * @param client - The Skynet client.
 * @param seed - The seed.
 * @param tweak - The user tweak.
 * @param [customOptions] - The custom login options.
 * @returns - An empty promise.
 */
export async function login(
  client: SkynetClient,
  seed: Uint8Array,
  tweak: string,
  customOptions?: CustomLoginOptions
): Promise<void> {
  const opts = { ...DEFAULT_LOGIN_OPTIONS, ...client.customOptions, ...customOptions };

  const { publicKey, privateKey } = genPortalLoginKeypair(seed, tweak);

  const loginRequestResponse = await client.executeRequest({
    endpointPath: opts.endpointLogin,
    method: "GET",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    query: { pubKey: publicKey },
  });

  const challenge = loginRequestResponse.data.challenge;
  const portalRecipient = getPortalRecipient(await client.portalUrl());
  const challengeResponse = signChallenge(privateKey, challenge, CHALLENGE_TYPE_LOGIN, portalRecipient);

  const data = challengeResponse;
  await client.executeRequest({
    endpointPath: opts.endpointLogin,
    method: "POST",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
    data,
  });
}

/**
 * Logs out a logged-in user.
 *
 * @param client - The Skynet client.
 * @param [customOptions] - The custom logout options.
 */
export async function logout(client: SkynetClient, customOptions?: CustomLogoutOptions): Promise<void> {
  const opts = { ...DEFAULT_LOGOUT_OPTIONS, ...client.customOptions, ...customOptions };

  await client.executeRequest({
    endpointPath: opts.endpointLogout,
    method: "POST",
    subdomain: PORTAL_ACCOUNT_PAGE_SUBDOMAIN,
  });
}

// =======
// Helpers
// =======

/**
 * Signs the given challenge.
 *
 * @param privateKey - The user's login private key.
 * @param challenge - The challenge received from the server.
 * @param challengeType - The type of the challenge.
 * @param portalRecipient - The portal we are communicating with.
 * @returns - The challenge response from the client.
 */
function signChallenge(
  privateKey: string,
  challenge: string,
  challengeType: "skynet-portal-login" | "skynet-portal-register",
  portalRecipient: string
): ChallengeResponse {
  validateHexString("challenge", challenge, "challenge from server");

  const challengeBytes = hexToUint8Array(challenge);
  validateUint8ArrayLen("challengeBytes", challengeBytes, "calculated challenge bytes", CHALLENGE_SIZE);

  const typeBytes = stringToUint8ArrayUtf8(challengeType);

  const portalBytes = stringToUint8ArrayUtf8(portalRecipient);

  const dataBytes = new Uint8Array([...challengeBytes, ...typeBytes, ...portalBytes]);

  const privateKeyBytes = hexToUint8Array(privateKey);
  const signatureBytes = sign(dataBytes, privateKeyBytes).slice(0, CHALLENGE_SIGNATURE_SIZE);
  validateUint8ArrayLen("signatureBytes", signatureBytes, "calculated signature", CHALLENGE_SIGNATURE_SIZE);

  return {
    response: toHexString(dataBytes),
    signature: toHexString(signatureBytes),
  };
}

/**
 * Generates a portal login keypair.
 *
 * @param seed - The user seed.
 * @param tweak - The portal account tweak.
 * @returns - The login keypair.
 */
function genPortalLoginKeypair(seed: Uint8Array, tweak: string): KeyPair {
  const hash = hashWithSalt(seed, tweak);

  return genKeyPairFromHash(hash);
}

/**
 * Gets the portal recipient string from the portal URL, e.g. https://siasky.net
 * => https://siasky.net, https://dev1.siasky.dev => https://siasky.dev.
 *
 * @param portalUrl - The full portal URL.
 * @returns - The shortened portal recipient URL.
 */
export function getPortalRecipient(portalUrl: string): string {
  const url = new URL(ensureUrl(portalUrl));

  // Get last two portions of the hostname.
  url.hostname = url.hostname.split(".").slice(-2).join(".");

  return trimSuffix(url.toString(), "/");
}
