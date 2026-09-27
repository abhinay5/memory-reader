import { z } from "zod";

// Extension pages forbid eval/new Function (MV3 CSP); tell zod not to probe for it.
z.config({ jitless: true });
