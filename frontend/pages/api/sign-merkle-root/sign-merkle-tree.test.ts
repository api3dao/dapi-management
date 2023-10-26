import { createMocks } from 'node-mocks-http';
import signRoot from './[tree]';

describe('/api/sign-merkle-root/[tree]', () => {
  test('signs the merkle tree root', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        signature: "string",
        address: "string"
      },
      query: {
        tree: 'DAPI_FALLBACK',
      },
    });

    signRoot(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(res._getData()).toEqual("Signature file not found");
  });
});