"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processJobStubV3 = exports.createJob = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
exports.createJob = (0, https_1.onCall)({ cors: true }, async (req) => {
    var _a, _b;
    if (!req.auth) {
        throw new https_1.HttpsError("unauthenticated", "Sign in first");
    }
    const templateId = (_a = req.data) === null || _a === void 0 ? void 0 : _a.templateId;
    if (!templateId || typeof templateId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "templateId is required");
    }
    const tpl = await db.doc(`templates/${templateId}`).get();
    if (!tpl.exists || ((_b = tpl.data()) === null || _b === void 0 ? void 0 : _b.isActive) !== true) {
        throw new https_1.HttpsError("failed-precondition", "Template is not active");
    }
    const jobRef = db.collection("jobs").doc();
    await jobRef.set({
        uid: req.auth.uid,
        templateId,
        status: "queued",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const uploadPath = `user_uploads/${req.auth.uid}/${jobRef.id}/photo.jpg`;
    return { jobId: jobRef.id, uploadPath };
});
exports.processJobStubV3 = (0, firestore_1.onDocumentUpdated)("jobs/{jobId}", async (event) => {
    var _a, _b;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const afterSnap = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after;
    const after = afterSnap === null || afterSnap === void 0 ? void 0 : afterSnap.data();
    if (!before || !after || !afterSnap)
        return;
    const inputAdded = !before.inputImageUrl && !!after.inputImageUrl;
    if (!inputAdded)
        return;
    if (after.status !== "queued")
        return;
    const ref = afterSnap.ref;
    await ref.update({
        status: "processing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.update({
        status: "failed",
        errorMessage: "Kling not configured yet (stub).",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
});
//# sourceMappingURL=index.js.map