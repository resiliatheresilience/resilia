import { getStore } from "@netlify/blobs";

export default async () => {
  try {
    const store = getStore("resilia-appointment-requests");
    const { blobs } = await store.list({ prefix: "appointment-requests/" });
    let deleted = 0;
    for (const blob of blobs) {
      const record = await store.getWithMetadata(blob.key);
      if (record?.metadata?.expiresAt && record.metadata.expiresAt <= Date.now()) {
        await store.delete(blob.key);
        deleted += 1;
      }
    }
    console.info("Expired appointment records purged", { deleted });
  } catch (error) {
    console.error("Appointment retention cleanup failed", { type: error?.name || "Error" });
  }
};

export const config = { schedule: "@daily" };
