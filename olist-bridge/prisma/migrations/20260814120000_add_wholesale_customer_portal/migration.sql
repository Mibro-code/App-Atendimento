CREATE TABLE "WholesaleCustomer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCredential" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCompany" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT NOT NULL,
    "olistCustomerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCustomerCompany" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCustomerCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "olistOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT,
    "paymentStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "subtotal" DECIMAL(14,2),
    "discountValue" DECIMAL(14,2),
    "shippingValue" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "orderedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "olistItemId" TEXT,
    "productName" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "discountValue" DECIMAL(14,2),
    "totalPrice" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleInvoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "olistInvoiceId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceSeries" TEXT,
    "invoiceKey" TEXT,
    "danfeUrl" TEXT,
    "xmlUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleTracking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "trackingCode" TEXT,
    "carrier" TEXT,
    "service" TEXT,
    "status" TEXT,
    "lastUpdate" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleTracking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleTrackingEvent" (
    "id" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "externalEventId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT,
    "description" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WholesaleTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WholesaleCustomer_shop_shopifyCustomerId_key" ON "WholesaleCustomer"("shop", "shopifyCustomerId");
CREATE UNIQUE INDEX "WholesaleCustomer_shop_emailNormalized_key" ON "WholesaleCustomer"("shop", "emailNormalized");
CREATE INDEX "WholesaleCustomer_shop_idx" ON "WholesaleCustomer"("shop");
CREATE INDEX "WholesaleCustomer_email_idx" ON "WholesaleCustomer"("email");
CREATE UNIQUE INDEX "WholesaleCredential_customerId_key" ON "WholesaleCredential"("customerId");
CREATE UNIQUE INDEX "WholesaleCompany_shop_cnpj_key" ON "WholesaleCompany"("shop", "cnpj");
CREATE UNIQUE INDEX "WholesaleCompany_shop_olistCustomerId_key" ON "WholesaleCompany"("shop", "olistCustomerId");
CREATE INDEX "WholesaleCompany_cnpj_idx" ON "WholesaleCompany"("cnpj");
CREATE UNIQUE INDEX "WholesaleCustomerCompany_customerId_companyId_key" ON "WholesaleCustomerCompany"("customerId", "companyId");
CREATE INDEX "WholesaleCustomerCompany_companyId_idx" ON "WholesaleCustomerCompany"("companyId");
CREATE UNIQUE INDEX "WholesaleOrder_shop_olistOrderId_key" ON "WholesaleOrder"("shop", "olistOrderId");
CREATE UNIQUE INDEX "WholesaleOrder_companyId_orderNumber_key" ON "WholesaleOrder"("companyId", "orderNumber");
CREATE INDEX "WholesaleOrder_companyId_orderedAt_idx" ON "WholesaleOrder"("companyId", "orderedAt");
CREATE INDEX "WholesaleOrder_shop_status_idx" ON "WholesaleOrder"("shop", "status");
CREATE INDEX "WholesaleOrder_orderNumber_idx" ON "WholesaleOrder"("orderNumber");
CREATE UNIQUE INDEX "WholesaleOrderItem_orderId_olistItemId_key" ON "WholesaleOrderItem"("orderId", "olistItemId");
CREATE INDEX "WholesaleOrderItem_orderId_idx" ON "WholesaleOrderItem"("orderId");
CREATE INDEX "WholesaleOrderItem_sku_idx" ON "WholesaleOrderItem"("sku");
CREATE UNIQUE INDEX "WholesaleInvoice_orderId_key" ON "WholesaleInvoice"("orderId");
CREATE INDEX "WholesaleInvoice_invoiceKey_idx" ON "WholesaleInvoice"("invoiceKey");
CREATE UNIQUE INDEX "WholesaleTracking_orderId_key" ON "WholesaleTracking"("orderId");
CREATE INDEX "WholesaleTracking_trackingCode_idx" ON "WholesaleTracking"("trackingCode");
CREATE UNIQUE INDEX "WholesaleTrackingEvent_trackingId_fingerprint_key" ON "WholesaleTrackingEvent"("trackingId", "fingerprint");
CREATE UNIQUE INDEX "WholesaleTrackingEvent_trackingId_externalEventId_key" ON "WholesaleTrackingEvent"("trackingId", "externalEventId");
CREATE INDEX "WholesaleTrackingEvent_trackingId_eventDate_idx" ON "WholesaleTrackingEvent"("trackingId", "eventDate");

ALTER TABLE "WholesaleCustomerCompany" ADD CONSTRAINT "WholesaleCustomerCompany_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WholesaleCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCredential" ADD CONSTRAINT "WholesaleCredential_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WholesaleCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCustomerCompany" ADD CONSTRAINT "WholesaleCustomerCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "WholesaleCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "WholesaleCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrderItem" ADD CONSTRAINT "WholesaleOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleInvoice" ADD CONSTRAINT "WholesaleInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleTracking" ADD CONSTRAINT "WholesaleTracking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleTrackingEvent" ADD CONSTRAINT "WholesaleTrackingEvent_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "WholesaleTracking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
