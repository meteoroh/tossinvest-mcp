/**
 * Output schemas advertised to MCP clients.
 *
 * They are deliberately permissive: objects are `loose` (unknown keys pass
 * through) and non-guaranteed fields are `nullish()`. The Toss API documents
 * that clients must tolerate unknown enum values and new fields, so a strict
 * schema would turn a harmless API addition into a tool failure. The value here
 * is documentation — the model sees exactly which fields to expect.
 *
 * Monetary values and quantities are decimal *strings* throughout the Toss API.
 */

import { z } from "zod";

const loose = z.looseObject;

/** Fields `buildToolResult` may add when a list is shortened. */
const truncationFields = {
    truncated: z.boolean().nullish(),
    truncation_message: z.string().nullish()
};

const currency = z.string().nullish().describe("KRW or USD");
const decimal = z.string().nullish().describe("Decimal value as a string");

export const AccountsOutput = {
    count: z.number(),
    accounts: z.array(
        loose({
            accountNo: z.string().nullish().describe("Account number"),
            accountSeq: z.number().describe("Pass this as account_seq / X-Tossinvest-Account"),
            accountType: z.string().nullish().describe("BROKERAGE, PENSION_SAVINGS, OVERSEAS_DERIVATIVES or RESHORING_INVESTMENT")
        })
    )
};

export const PricesOutput = {
    count: z.number(),
    prices: z.array(
        loose({
            symbol: z.string(),
            lastPrice: decimal.describe("Current price in `currency`"),
            currency,
            timestamp: z.string().nullish().describe("Quote time; null when no trade has occurred")
        })
    ),
    ...truncationFields
};

const orderbookLevel = loose({ price: decimal, volume: decimal });

export const OrderbookOutput = {
    symbol: z.string(),
    currency,
    timestamp: z.string().nullish(),
    asks: z.array(orderbookLevel).describe("Sell side, ascending by price"),
    bids: z.array(orderbookLevel).describe("Buy side, descending by price")
};

export const TradesOutput = {
    symbol: z.string(),
    count: z.number(),
    trades: z.array(
        loose({
            price: decimal,
            volume: decimal,
            timestamp: z.string().nullish(),
            currency
        })
    ),
    ...truncationFields
};

export const PriceLimitsOutput = {
    symbol: z.string(),
    currency,
    timestamp: z.string().nullish(),
    upperLimitPrice: decimal.describe("Daily upper limit; null when the market has no limit"),
    lowerLimitPrice: decimal.describe("Daily lower limit; null when the market has no limit")
};

const candle = loose({
    timestamp: z.string().nullish().describe("Bar open time"),
    openPrice: decimal,
    highPrice: decimal,
    lowPrice: decimal,
    closePrice: decimal,
    volume: decimal,
    currency
});

export const CandlesOutput = {
    symbol: z.string(),
    interval: z.string(),
    count: z.number(),
    candles: z.array(candle).describe("Newest bar first"),
    nextBefore: z.string().nullish().describe("Pass as `before` to fetch the next (older) page; null when no more data"),
    ...truncationFields
};

export const StocksOutput = {
    count: z.number(),
    stocks: z.array(
        loose({
            symbol: z.string(),
            name: z.string().nullish().describe("Korean name"),
            englishName: z.string().nullish(),
            isinCode: z.string().nullish(),
            market: z.string().nullish().describe("KOSPI, KOSDAQ, NYSE, NASDAQ, AMEX, KR_ETC or US_ETC"),
            securityType: z.string().nullish().describe("STOCK, ETF, REIT, ETN, DEPOSITARY_RECEIPT, …"),
            isCommonShare: z.boolean().nullish().describe("false for preferred shares"),
            status: z.string().nullish().describe("SCHEDULED, ACTIVE or DELISTED"),
            currency,
            listDate: z.string().nullish(),
            delistDate: z.string().nullish(),
            sharesOutstanding: decimal,
            leverageFactor: decimal.describe("ETF/ETN leverage, e.g. '2.0' or '-1.0'; null otherwise"),
            koreanMarketDetail: z
                .looseObject({
                    liquidationTrading: z.boolean().nullish(),
                    nxtSupported: z.boolean().nullish(),
                    krxTradingSuspended: z.boolean().nullish(),
                    nxtTradingSuspended: z.boolean().nullish()
                })
                .nullish()
                .describe("Korean-market-only detail; null for US symbols")
        })
    ),
    ...truncationFields
};

export const StockWarningsOutput = {
    symbol: z.string(),
    count: z.number(),
    warnings: z
        .array(
            loose({
                warningType: z
                    .string()
                    .nullish()
                    .describe("LIQUIDATION_TRADING, OVERHEATED, INVESTMENT_WARNING, INVESTMENT_RISK, VI_STATIC, VI_DYNAMIC, VI_STATIC_AND_DYNAMIC or STOCK_WARRANTS"),
                exchange: z.string().nullish(),
                startDate: z.string().nullish(),
                endDate: z.string().nullish().describe("null while still in effect")
            })
        )
        .describe("Active warnings, newest first. Empty when the symbol has none.")
};

export const ExchangeRateOutput = {
    baseCurrency: currency,
    quoteCurrency: currency,
    rate: decimal.describe("Applied rate"),
    midRate: decimal,
    basisPoint: decimal,
    rateChangeType: z.string().nullish().describe("UP, EQUAL or DOWN"),
    validFrom: z.string().nullish(),
    validUntil: z.string().nullish()
};

export const MarketCalendarOutput = {
    country: z.string().describe("KR or US"),
    previousBusinessDay: z.looseObject({}).nullish(),
    today: z.looseObject({}).nullish(),
    nextBusinessDay: z.looseObject({}).nullish()
};

export const RankingsOutput = {
    type: z.string(),
    marketCountry: z.string(),
    duration: z.string(),
    count: z.number(),
    rankedAt: z.string().nullish().describe("null when no ranking has been computed for this combination"),
    rankings: z.array(
        loose({
            rank: z.number().nullish(),
            symbol: z.string().nullish(),
            currency,
            price: z
                .looseObject({
                    lastPrice: decimal,
                    basePrice: decimal,
                    changeRate: decimal
                })
                .nullish(),
            tradingVolume: decimal,
            tradingAmount: decimal
        })
    ),
    ...truncationFields
};

export const MarketIndicatorPricesOutput = {
    count: z.number(),
    prices: z.array(
        loose({
            symbol: z.string(),
            lastPrice: decimal.describe("Index points for KOSPI/KOSDAQ, percent yield for KR_BOND_*"),
            timestamp: z.string().nullish()
        })
    )
};

export const MarketIndicatorCandlesOutput = {
    symbol: z.string(),
    interval: z.string(),
    count: z.number(),
    candles: z.array(candle),
    nextBefore: z.string().nullish(),
    ...truncationFields
};

const investorAmount = loose({ buyAmount: decimal, sellAmount: decimal });

export const InvestorTradingOutput = {
    symbol: z.string(),
    interval: z.string(),
    count: z.number(),
    records: z.array(
        loose({
            date: z.string().nullish(),
            updatedAt: z.string().nullish().describe("Same-day records are provisional until the close"),
            individual: investorAmount.nullish(),
            foreigner: investorAmount.nullish(),
            institution: z.looseObject({ buyAmount: decimal, sellAmount: decimal, breakdown: z.looseObject({}).nullish() }).nullish(),
            otherCorporation: investorAmount.nullish()
        })
    ).describe("All amounts are KRW integers, newest first"),
    nextUntil: z.string().nullish().describe("Pass as `until` for the next (older) page"),
    ...truncationFields
};

export const HoldingsOutput = {
    accountSeq: z.number(),
    count: z.number(),
    totalPurchaseAmount: z.looseObject({}).nullish().describe("Cost basis, summed per currency ({ krw, usd })"),
    marketValue: z.looseObject({}).nullish(),
    profitLoss: z.looseObject({}).nullish(),
    dailyProfitLoss: z.looseObject({}).nullish(),
    items: z.array(
        loose({
            symbol: z.string(),
            name: z.string().nullish(),
            marketCountry: z.string().nullish(),
            currency,
            quantity: decimal,
            lastPrice: decimal,
            averagePurchasePrice: decimal,
            marketValue: z.looseObject({}).nullish(),
            profitLoss: z.looseObject({}).nullish(),
            dailyProfitLoss: z.looseObject({}).nullish(),
            cost: z.looseObject({}).nullish()
        })
    ),
    ...truncationFields
};

const order = loose({
    orderId: z.string(),
    symbol: z.string().nullish(),
    side: z.string().nullish().describe("BUY or SELL"),
    orderType: z.string().nullish().describe("LIMIT or MARKET"),
    timeInForce: z.string().nullish().describe("DAY, CLS or OPG"),
    status: z.string().nullish().describe("PENDING, PARTIAL_FILLED, PENDING_CANCEL, PENDING_REPLACE, FILLED, CANCELED, REJECTED, REPLACED, CANCEL_REJECTED or REPLACE_REJECTED"),
    price: decimal.describe("null for MARKET orders"),
    quantity: decimal,
    orderAmount: decimal.describe("Set only for US amount-based market orders"),
    currency,
    orderedAt: z.string().nullish(),
    canceledAt: z.string().nullish(),
    execution: z
        .looseObject({
            filledQuantity: decimal,
            averageFilledPrice: decimal,
            filledAmount: decimal,
            commission: decimal,
            tax: decimal,
            filledAt: z.string().nullish(),
            settlementDate: z.string().nullish()
        })
        .nullish()
});

export const OrdersOutput = {
    accountSeq: z.number(),
    status: z.string(),
    count: z.number(),
    orders: z.array(order),
    nextCursor: z.string().nullish().describe("Pass as `cursor` for the next page (CLOSED only)"),
    hasNext: z.boolean().nullish(),
    ...truncationFields
};

export const OrderOutput = { accountSeq: z.number(), order };

export const OrderOperationOutput = {
    accountSeq: z.number(),
    orderId: z.string().describe("Identifier of the resulting order"),
    operation: z.string().describe("created, modified or canceled"),
    note: z.string().nullish()
};

export const BuyingPowerOutput = {
    accountSeq: z.number(),
    currency,
    cashBuyingPower: decimal.describe("Cash-only buying power, excluding margin")
};

export const SellableQuantityOutput = {
    accountSeq: z.number(),
    symbol: z.string(),
    sellableQuantity: decimal
};

export const CommissionsOutput = {
    accountSeq: z.number(),
    count: z.number(),
    commissions: z.array(
        loose({
            marketCountry: z.string().nullish().describe("KR or US"),
            commissionRate: decimal.describe("Percent, e.g. '0.015' means 0.015%"),
            startDate: z.string().nullish(),
            endDate: z.string().nullish()
        })
    )
};

const conditionalOrder = loose({
    conditionalOrderId: z.string(),
    type: z.string().nullish().describe("SINGLE, OCO or OTO"),
    status: z.string().nullish().describe("WATCHING, PAUSED, ORDERING, ORDERED, COMPLETED or EXPIRED"),
    symbol: z.string().nullish(),
    market: z.string().nullish(),
    quantity: decimal,
    orderType: z.string().nullish(),
    expireDate: z.string().nullish(),
    createdAt: z.string().nullish(),
    first: z.looseObject({}).nullish().describe("First watched condition"),
    second: z.looseObject({}).nullish().describe("Second condition; null for SINGLE")
});

export const ConditionalOrdersOutput = {
    accountSeq: z.number(),
    status: z.string(),
    count: z.number(),
    conditionalOrders: z.array(conditionalOrder),
    nextCursor: z.string().nullish(),
    hasNext: z.boolean().nullish(),
    ...truncationFields
};

export const ConditionalOrderOutput = { accountSeq: z.number(), conditionalOrder };

export const ConditionalOrderOperationOutput = {
    accountSeq: z.number(),
    conditionalOrderId: z.string().describe("Identifier to use from now on — a modify issues a NEW id and invalidates the old one"),
    clientOrderId: z.string().nullish(),
    operation: z.string().describe("created, modified or canceled"),
    note: z.string().nullish()
};
