import { AxiosResponse } from "axios";
import type { Connection } from "post-me";
import { ChildHandshake, WindowMessenger } from "post-me";
import {
  deriveDiscoverableFileTweak,
  deriveEncryptedFileTweak,
  RegistryEntry,
  signEntry,
  SkynetClient,
  PUBLIC_KEY_LENGTH,
  PRIVATE_KEY_LENGTH,
  RequestConfig,
  ExecuteRequestError,
  JsonData,
} from "skynet-js";

import { CheckPermissionsResponse, PermCategory, Permission, PermType } from "skynet-mysky-utils";
import { sign } from "tweetnacl";
import { genKeyPairFromSeed, hashWithSalt, sha512 } from "./crypto";
import { deriveEncryptedPathSeedForRoot, ENCRYPTION_ROOT_PATH_SEED_BYTES_LENGTH } from "./encrypted_files";
import { login, logout } from "./portal-account";
import { launchPermissionsProvider } from "./provider";
import { SEED_LENGTH } from "./seed";
import { fromHexString, log, readablePermission } from "./util";

export const SEED_STORAGE_KEY = "seed";
export const EMAIL_STORAGE_KEY = "email";

// Descriptive salt that should not be changed.
const SALT_ENCRYPTED_PATH_SEED = "encrypted filesystem path seed";

// SALT_MESSAGE_SIGNING is the prefix with which we salt the data that MySky
// signs in order to be able to prove ownership of the MySky id.
const SALT_MESSAGE_SIGNING = "MYSKY_ID_VERIFICATION";

// Set `dev` based on whether we built production or dev.
let dev = false;
/// #if ENV == 'dev'
dev = true;
/// #endif

/**
 * Convenience class containing the permissions provider handshake connection
 * and worker handle.
 */
export class PermissionsProvider {
  constructor(public connection: Connection, public worker: Worker) {}

  close() {
    this.worker.terminate();
    this.connection.close();
  }
}

export class MySky {
  protected parentConnection: Promise<Connection>;
  protected permissionsProvider: Promise<PermissionsProvider> | null = null;
  protected jwt: Promise<string> | null = null;

  // ============
  // Constructors
  // ============

  constructor(protected client: SkynetClient, protected referrerDomain: string, seed: Uint8Array | null) {
    // Set child methods.

    const methods = {
      checkLogin: this.checkLogin.bind(this),
      getEncryptedFileSeed: this.getEncryptedPathSeed.bind(this),
      getEncryptedPathSeed: this.getEncryptedPathSeed.bind(this),
      logout: this.logout.bind(this),
      signMessage: this.signMessage.bind(this),
      signRegistryEntry: this.signRegistryEntry.bind(this),
      signEncryptedRegistryEntry: this.signEncryptedRegistryEntry.bind(this),
      userID: this.userID.bind(this),
      verifyMessageSignature: this.verifyMessageSignature.bind(this),
    };

    // Enable communication with connector in parent skapp.

    log("Making handshake");
    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: window.parent,
      remoteOrigin: "*",
    });
    this.parentConnection = ChildHandshake(messenger, methods);

    // Launch the permissions provider if the seed was given.

    if (seed) {
      this.permissionsProvider = launchPermissionsProvider(seed);
    }
  }

  static async initialize(): Promise<MySky> {
    log("Initializing...");

    if (typeof Storage == "undefined") {
      throw new Error("Browser does not support web storage");
    }

    // Check for stored seed in localstorage.
    const seed = checkStoredSeed();

    let email = null;
    let portal = null;
    if (seed) {
      const userSettings = await getUserSettings(seed);

      // TODO: Check for stored portal and email in user settings.
      if (userSettings) {
        email = (userSettings.email as string) || null;
        portal = (userSettings.portal as string) || null;
      }
    }

    // Initialize the Skynet client.
    const client = new SkynetClient(portal || undefined);

    if (seed) {
      // Set up auto-relogin if the email was found.
      if (email) {
        setupAutoRelogin(client, seed, email);
      }
    }

    // Get the referrer.
    const referrerDomain = await client.extractDomain(document.referrer);

    // Create MySky object.
    log("Calling new MySky()");
    const mySky = new MySky(client, referrerDomain, seed);

    // Set up the storage event listener.
    mySky.setUpStorageEventListener();

    return mySky;
  }

  // ==========
  // Public API
  // ==========

  /**
   * Checks whether the user can be automatically logged in (the seed is present
   * and required permissions are granted).
   *
   * @param perms - The requested permissions.
   * @returns - Whether the seed is present and a list of granted and rejected permissions.
   */
  async checkLogin(perms: Permission[]): Promise<[boolean, CheckPermissionsResponse]> {
    log("Entered checkLogin");

    // Check for stored seed in localstorage.
    const seed = checkStoredSeed();
    if (!seed) {
      log("Seed not found");
      const permissionsResponse = { grantedPermissions: [], failedPermissions: perms };
      return [false, permissionsResponse];
    }

    // Load of permissions provider should have been triggered by now, either
    // when initiatializing MySky frame or when setting seed in MySky UI.
    if (!this.permissionsProvider) {
      throw new Error("Permissions provider not loaded");
    }

    // Check given permissions with the permissions provider.
    log("Calling checkPermissions");
    const provider = await this.permissionsProvider;
    const permissionsResponse: CheckPermissionsResponse = await provider.connection
      .remoteHandle()
      .call("checkPermissions", perms, dev);

    return [true, permissionsResponse];
  }

  /**
   * Gets the encrypted path seed for the given path.
   *
   * @param path - The given file or directory path.
   * @param isDirectory - Whether the path corresponds to a directory.
   * @returns - The hex-encoded encrypted path seed.
   */
  async getEncryptedPathSeed(path: string, isDirectory: boolean): Promise<string> {
    log("Entered getEncryptedPathSeed");

    // Check with the permissions provider that we have permission for this request.

    await this.checkPermission(path, PermCategory.Hidden, PermType.Read);

    // Get the seed.

    const seed = checkStoredSeed();
    if (!seed) {
      throw new Error("User seed not found");
    }

    // Compute the root path seed.

    const bytes = new Uint8Array([...sha512(SALT_ENCRYPTED_PATH_SEED), ...sha512(seed)]);
    // NOTE: Truncate to 32 bytes instead of the 64 bytes for a directory path
    // seed. This is a historical artifact left for backwards compatibility.
    const rootPathSeedBytes = sha512(bytes).slice(0, ENCRYPTION_ROOT_PATH_SEED_BYTES_LENGTH);

    // Compute the child path seed.

    return deriveEncryptedPathSeedForRoot(rootPathSeedBytes, path, isDirectory);
  }

  // TODO: Logout from all tabs.
  /**
   * Logs out of MySky.
   */
  async logout(): Promise<void> {
    const errors = [];

    // Check if user is logged in.
    const seed = checkStoredSeed();

    if (seed) {
      // Clear the stored seed.
      clearStoredSeed();
    } else {
      errors.push(new Error("MySky user is already logged out"));
    }

    // Clear the JWT cookie.
    //
    // NOTE: We do this even if we could not find a seed above. The local
    // storage might have been cleared with the JWT token still being active.
    //
    // NOTE: This will not auto-login on an expired JWT just to logout again.
    try {
      await logout(this.client);
    } catch (e) {
      errors.push(e);
    }

    // TODO: Restore original `executeRequest` on logout.

    // Throw all encountered errors.
    if (errors.length > 0) {
      throw new Error(`Error${errors.length > 1 ? "s" : ""} logging out: ${errors}`);
    }
  }

  /**
   * Signs the given data using the MySky user's private key. This method can be
   * used for MySky user verification as the signature may be verified against
   * the user's public key, which is the MySky user id.
   *
   * NOTE: verifyMessageSignature is the counter part of this method, and
   * verifies an original message against the signature and the user's public
   * key
   *
   * NOTE: This function (internally) adds a salt to the given data array to
   * ensure there's no potential overlap with anything else, like registry
   * entries.
   *
   * @param message - message to sign
   * @returns signature
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    // fetch the user's seed
    const seed = checkStoredSeed();
    if (!seed) {
      throw new Error("User seed not found");
    }

    // fetch the private key and sanity check the length
    const { privateKey } = genKeyPairFromSeed(seed);
    if (!privateKey) {
      throw new Error("Private key not found");
    }
    if (privateKey.length !== PRIVATE_KEY_LENGTH) {
      throw new Error(`Private key had the incorrect length, ${privateKey.length}!=${PRIVATE_KEY_LENGTH}`);
    }

    // convert it to bytes
    const privateKeyBytes = fromHexString(privateKey);
    if (!privateKeyBytes) {
      throw new Error("Private key was not properly hex-encoded");
    }

    // Prepend a salt to the message, essentially name spacing it so the
    // signature is only useful for MySky ID verification.
    const hash = hashWithSalt(message, SALT_MESSAGE_SIGNING);

    // Return the signature.
    return sign.detached(hash, privateKeyBytes);
  }

  async signRegistryEntry(entry: RegistryEntry, path: string): Promise<Uint8Array> {
    // Check that the entry data key corresponds to the right path.

    const dataKey = deriveDiscoverableFileTweak(path);
    if (entry.dataKey !== dataKey) {
      throw new Error("Path does not match the data key in the registry entry.");
    }

    return this.signRegistryEntryHelper(entry, path, PermCategory.Discoverable);
  }

  async signEncryptedRegistryEntry(entry: RegistryEntry, path: string): Promise<Uint8Array> {
    // Check that the entry data key corresponds to the right path.

    // Use `isDirectory: false` because registry entries can only correspond to files right now.
    const pathSeed = await this.getEncryptedPathSeed(path, false);
    const dataKey = deriveEncryptedFileTweak(pathSeed);
    if (entry.dataKey !== dataKey) {
      throw new Error("Path does not match the data key in the encrypted registry entry.");
    }

    return this.signRegistryEntryHelper(entry, path, PermCategory.Hidden);
  }

  async userID(): Promise<string> {
    // Get the seed.

    const seed = checkStoredSeed();
    if (!seed) {
      throw new Error("User seed not found");
    }

    // Get the public key.

    const { publicKey } = genKeyPairFromSeed(seed);
    return publicKey;
  }

  /**
   * verifyMessageSignature verifies the signature for the message and given
   * public key and returns a boolean that indicates whether the verification
   * succeeded.
   *
   * @param message - the original message that was signed
   * @param signature - the signature
   * @param publicKey - the public key
   * @returns boolean that indicates whether the verification succeeded
   */
  async verifyMessageSignature(message: Uint8Array, signature: Uint8Array, publicKey: string): Promise<boolean> {
    // sanity check the public key length
    if (publicKey.length !== PUBLIC_KEY_LENGTH) {
      throw new Error(`Public key had the incorrect length, ${publicKey.length}!=${PUBLIC_KEY_LENGTH}`);
    }

    // convert it to bytes
    const publicKeyBytes = fromHexString(publicKey);
    if (!publicKeyBytes) {
      throw new Error("Public key was not properly hex-encoded");
    }

    // reconstruct the original message
    const originalMessage = sha512(new Uint8Array([...sha512(SALT_MESSAGE_SIGNING), ...sha512(message)]));

    // verify the message against the signature and public key
    return sign.detached.verify(originalMessage, signature, publicKeyBytes);
  }

  // ================
  // Internal Methods
  // ================

  /**
   * Set up a listener for the storage event.
   *
   * If the seed is set in the UI, it should trigger a load of the permissions
   * provider. If the email is set, it should set up automatic re-login on JWT
   * cookie expiry.
   */
  setUpStorageEventListener(): void {
    window.addEventListener("storage", ({ key, newValue }: StorageEvent) => {
      if (key !== SEED_STORAGE_KEY) {
        return;
      }

      if (this.permissionsProvider) {
        // Unload the old permissions provider. No need to await on this.
        void this.permissionsProvider.then((provider) => provider.close());
        this.permissionsProvider = null;
      }

      if (!newValue) {
        // Seed was removed.
        return;
      }

      // Parse the seed.
      const seed = new Uint8Array(JSON.parse(newValue));

      // Launch the new permissions provider.
      this.permissionsProvider = launchPermissionsProvider(seed);

      // If the email is found, then set up auto-login on Main MySky.
      const email = localStorage.getItem(EMAIL_STORAGE_KEY);
      if (email) {
        // Clear the stored email.
        //
        // The email can be cleared here because `localStorage` is only used to
        // marshal the email from MySky UI over to the invisible MySky iframe.
        // We don't clear the seed because we need it in storage so that users
        // are automatically logged-in, when possible. But for the email, it
        // should be stored on MySky, as the local storage can get cleared,
        // users can move across browsers etc.
        localStorage.removeItem(EMAIL_STORAGE_KEY);

        // Set up auto re-login on JWT expiry.
        setupAutoRelogin(this.client, seed, email);
      }
    });
  }

  async signRegistryEntryHelper(entry: RegistryEntry, path: string, category: PermCategory): Promise<Uint8Array> {
    log("Entered signRegistryEntry");

    // Check with the permissions provider that we have permission for this request.

    await this.checkPermission(path, category, PermType.Write);

    // Get the seed.

    const seed = checkStoredSeed();
    if (!seed) {
      throw new Error("User seed not found");
    }

    // Get the private key.

    const { privateKey } = genKeyPairFromSeed(seed);

    // Sign the entry.

    const signature = await signEntry(privateKey, entry, true);
    return signature;
  }

  async checkPermission(path: string, category: PermCategory, permType: PermType): Promise<void> {
    // Check for the permissions provider.

    if (!this.permissionsProvider) {
      throw new Error("Permissions provider not loaded");
    }

    const perm = new Permission(this.referrerDomain, path, category, permType);
    log(`Checking permission: ${JSON.stringify(perm)}`);
    const provider = await this.permissionsProvider;
    const resp: CheckPermissionsResponse = await provider.connection
      .remoteHandle()
      .call("checkPermissions", [perm], dev);
    if (resp.failedPermissions.length > 0) {
      const readablePerm = readablePermission(perm);
      throw new Error(`Permission was not granted: ${readablePerm}`);
    }
  }
}

// =======
// Helpers
// =======

// TODO: Restore original executeRequest on logout.
/**
 * Sets up auto re-login. It modifies the client's `executeRequest` method to
 * check if the request failed with 401 Unauthorized Response. If so, it will
 * try to login and make the request again.
 *
 * NOTE: If the request was a portal account logout, we will not login again
 * just to logout. We also will not throw an error on 401, instead returning
 * silently. There is no way for the client to know whether the cookie is set
 * ahead of time, and an error would not be actionable.
 *
 * @param client - The Skynet client.
 * @param seed - The user seed.
 * @param email - The user email.
 */
function setupAutoRelogin(client: SkynetClient, seed: Uint8Array, email: string): void {
  const executeRequest = client.executeRequest;
  client.executeRequest = async function (config: RequestConfig): Promise<AxiosResponse> {
    try {
      return await executeRequest(config);
    } catch (e) {
      if ((e as ExecuteRequestError).responseStatus === 401) {
        // Try logging in again.
        await login(this, seed, email);
        return await executeRequest(config);
      } else {
        throw e;
      }
    }
  };
}

/**
 * Checks for seed stored in local storage from previous sessions.
 *
 * @returns - The seed, or null if not found.
 */
export function checkStoredSeed(): Uint8Array | null {
  log("Entered checkStoredSeed");

  if (!localStorage) {
    console.log("WARNING: localStorage disabled");
    return null;
  }

  const seedStr = localStorage.getItem(SEED_STORAGE_KEY);
  if (!seedStr) {
    return null;
  }

  // If we can't make a uint8 array out of the stored value, clear it and return null.
  let seed;
  try {
    const arr = JSON.parse(seedStr);
    seed = new Uint8Array(arr);
    if (seed.length !== SEED_LENGTH) {
      throw new Error("Bad seed length");
    }
  } catch (err) {
    log(err as string);
    clearStoredSeed();
    return null;
  }

  return seed;
}

/**
 * Clears the stored seed from local storage.
 */
export function clearStoredSeed(): void {
  log("Entered clearStoredSeed");

  if (!localStorage) {
    console.log("WARNING: localStorage disabled");
    return;
  }

  localStorage.removeItem(SEED_STORAGE_KEY);
}

// TODO
/**
 * Gets the user settings stored in the root of the MySky domain.
 *
 * @param _seed - The user seed.
 * @returns - The user settings if found.
 */
async function getUserSettings(_seed: Uint8Array): Promise<JsonData | null> {
  return null;
}
