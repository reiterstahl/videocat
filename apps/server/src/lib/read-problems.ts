import { riskyMediaPrefix } from "@videocat/shared";
import type { Prisma } from "@prisma/client";

// Files with a read problem: a read that did not answer or failed with an I/O error while the
// drive stayed connected (bad sectors). The Companion leaves them alone for a while; the web
// lists them and can ask to read them again on the next scan (readRetryAt).
export const readProblemWhere: Prisma.VideoFileWhereInput = {
  isPresent: true,
  scanStatus: "metadata_failed",
  errorMessage: { startsWith: riskyMediaPrefix }
};
