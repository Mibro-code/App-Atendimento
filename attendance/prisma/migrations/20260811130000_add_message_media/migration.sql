ALTER TABLE "Message"
ADD COLUMN "mediaStorageKey" TEXT,
ADD COLUMN "mediaMimeType" TEXT,
ADD COLUMN "mediaFileName" TEXT,
ADD COLUMN "mediaSize" INTEGER;
