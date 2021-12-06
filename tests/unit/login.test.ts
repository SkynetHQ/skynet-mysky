import sign from "jwt-encode";
import { DEFAULT_SKYNET_PORTAL_URL, SkynetClient } from "skynet-js";

import { phraseToSeed } from "../../src/seed";
import { login, register, COOKIE_HEADER_NAME, JWTData } from "../../src/login";

const portalUrl = DEFAULT_SKYNET_PORTAL_URL;
const client = new SkynetClient(portalUrl);
const phrase = "topic gambit bumper lyrics etched dime going mocked abbey scrub irate depth absorb bias awful";
const seed = phraseToSeed(phrase);
const pubKey = "0fce18836a7f730ad8d0442c8f311530297ce2807456f1454a9a755cde5333a4";

const email = "foo@bar.com";
const challenge = "490ccffbbbcc304652488903ca425d42490ccffbbbcc304652488903ca425d42";
const jwtData: JWTData = {
  session: { identity: { traits: { email } } },
};
const cookie = sign(jwtData, "");
const headers: Record<string, unknown> = {};
headers[COOKIE_HEADER_NAME] = cookie;

client.executeRequest = jest.fn();

describe("Unit tests for registration and login", () => {
  it("should register a new user", async () => {
    client.executeRequest
      // @ts-expect-error - TS complains about this property not existing.
      .mockReturnValueOnce({
        data: {
          challenge,
        },
      })
      .mockReturnValueOnce({
        headers,
      });

    const receivedCookie = await register(client, seed, email);

    expect(receivedCookie).toEqual(cookie);

    expect(client.executeRequest).toHaveBeenCalledWith({
      endpointPath: "/api/register",
      method: "GET",
      subdomain: "account",
      query: { pubKey },
    });
    expect(client.executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: "/api/register",
        method: "POST",
        subdomain: "account",
      })
    );
  });

  it("should login an existing user", async () => {
    client.executeRequest
      // @ts-expect-error - TS complains about this property not existing.
      .mockReturnValueOnce({
        data: {
          challenge,
        },
      })
      .mockReturnValueOnce({
        headers,
      });

    const receivedCookie = await login(client, seed, email);

    expect(receivedCookie).toEqual(cookie);

    expect(client.executeRequest).toHaveBeenCalledWith({
      endpointPath: "/api/login",
      method: "GET",
      subdomain: "account",
      query: { pubKey },
    });
    expect(client.executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: "/api/login",
        method: "POST",
        subdomain: "account",
      })
    );
  });
});
