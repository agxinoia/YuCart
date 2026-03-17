const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

exports.uploadCleanedName = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const {
        originalName,
        cleanedName,
        storeLink,
        productLink,
        vendor,
        color,
        itemType,
        timestamp,
      } = req.body;

      if (!cleanedName || !originalName) {
         res.status(400).send({ success: false, error: "Missing required fields" });
         return;
      }

      const dataToSave = {
        originalName: originalName || "Unknown",
        cleanedName: cleanedName,
        storeLink: storeLink || "",
        productLink: productLink || "",
        vendor: vendor || "Unknown",
        color: color || null,
        itemType: itemType || null,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await admin.firestore().collection("cleaned_names").add(dataToSave);
      logger.info(`Successfully saved: ${cleanedName}`);
      res.status(200).send({ success: true, message: "Data saved securely." });
    } catch (error) {
      logger.error("Error saving to database:", error);
      res.status(500).send({ success: false, error: "Internal Server Error" });
    }
  }
);
