import { Connection, ParentHandshake, WorkerMessenger } from "post-me";
import { defaultHandshakeAttemptsInterval, defaultHandshakeMaxAttempts, ensureUrl } from "skynet-mysky-utils";

export const relativePermissionsWorkerUrl = "permissions.js";
export const relativePermissionsDisplayUrl = "permissions-display.html";
export const defaultSeedDisplayProvider = "seed-display.html";

const _permissionsProviderPreferencePath = "permissions-provider.json";

/**
 * Tries to get the saved permissions provider preference, returning the default provider if not found.
 *
 * @param _seed - The user seed as bytes.
 * @returns - The permissions provider URL.
 */
export async function getPermissionsProviderUrl(_seed: Uint8Array): Promise<string> {
  // Derive the user.
  // const { publicKey } = genKeyPairFromSeed(seed);

  // Check the user's saved preferences from hidden file.

  // TODO
  // const { preference } = this.getJSONHidden(permissionsProviderPreferencePath);

  return ensureUrl(window.location.hostname);
}

/**
 * Launches the user's permissions provider if set, or the default provider.
 *
 * @param seed - The user seed as bytes.
 * @returns - The handshake connection with the provider.
 */
export async function launchPermissionsProvider(seed: Uint8Array): Promise<Connection> {
  console.log("Entered launchPermissionsProvider");

  const permissionsProviderUrl = await getPermissionsProviderUrl(seed);

  // NOTE: This URL must obey the same-origin policy. If not the default permissions provider, it can be a base64 skylink on the current origin.
  const workerJsUrl = `${permissionsProviderUrl}/${relativePermissionsWorkerUrl}`;

  // Load the worker.

  // TODO: Return the worker and terminate it when not needed?
  const worker = new Worker(workerJsUrl);
  const messenger = new WorkerMessenger({ worker });
  // TODO: Pass custom handshake options?
  return await ParentHandshake(messenger, {}, defaultHandshakeMaxAttempts, defaultHandshakeAttemptsInterval);
}
