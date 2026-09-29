// Imported by test/import-without-credentials.test.mjs, in a child process
// with no credentials, to prove the client still refuses to build.
import { createCredlyClient } from '../../scripts/credly-client.mjs';

createCredlyClient();
