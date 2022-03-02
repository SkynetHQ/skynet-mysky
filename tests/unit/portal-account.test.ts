import { DEFAULT_SKYNET_PORTAL_URL, SkynetClient } from "skynet-js";

import { phraseToSeed } from "../../src/seed";
import { getPortalRecipient, login, register } from "../../src/portal_account";

const portalUrl = DEFAULT_SKYNET_PORTAL_URL;
const client = new SkynetClient(portalUrl);
const phrase = "topic gambit bumper lyrics etched dime going mocked abbey scrub irate depth absorb bias awful";
const seed = phraseToSeed(phrase);
const pubKey = "f4def115f11f70b90832e1c25d8b99258b346f241dc61fdf74aedb7003a980af";

const email = "foo@bar.com";
const tweak = "foobar";
const challenge = "490ccffbbbcc304652488903ca425d42490ccffbbbcc304652488903ca425d42";
const headers: Record<string, unknown> = {};

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

    await register(client, seed, email, tweak);

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

    await login(client, seed, tweak);

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

describe("getPortalRecipient", () => {
  const cases = [
    ["https://siasky.net", "https://siasky.net"],
    ["https://dev1.siasky.dev", "https://siasky.dev"],
  ];

  it.each(cases)("(%s) should return '%s'", (portalUrl, expectedRecipient) => {
    const recipient = getPortalRecipient(portalUrl);
    expect(recipient).toEqual(expectedRecipient);
  });
});
