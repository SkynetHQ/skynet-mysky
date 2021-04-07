import { Connection, ParentHandshake, WorkerMessenger } from "post-me";
import { genKeyPairFromSeed } from "skynet-js";

const defaultPermissionsProvider = "permissions.js";
const permissionsProviderPreferencePath = "permissions-provider.json";
export const defaultSeedDisplayProvider = "seed.html";

export async function launchPermissionsProvider(seed: string): Promise<Connection> {
  // Derive the user.
  const { publicKey } = genKeyPairFromSeed(seed);

  // Check the user's saved preferences from hidden file.

  // TODO
  const preference: string | null = null;
  // const { preference } = this.getJSONHidden(permissionsProviderPreferencePath);

  // If no saved preference, use the default permissions provider.

  // NOTE: This URL must obey the same-origin policy. If not the default permissions provider, it can be a base64 skylink on the current origin.
  let workerJsUrl;
  if (!preference) {
    workerJsUrl = defaultPermissionsProvider;
  } else {
    workerJsUrl = preference;
  }

  // Load the worker.

  // TODO: Return the worker and terminate it when not needed?
  const worker = new Worker(workerJsUrl);
  const messenger = new WorkerMessenger({ worker });
  // TODO: Pass custom handshake options?
  return await ParentHandshake(messenger);
}
