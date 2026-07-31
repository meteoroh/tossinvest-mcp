/**
 * Validates every output schema against a representative payload shaped like the
 * documented API response, plus the extra keys buildToolResult can add on
 * truncation. Mirrors what the MCP SDK does before returning structuredContent.
 */
import { normalizeObjectSchema, safeParse } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import * as out from "../dist/schemas/outputs.js";

const price = { krw: "1000", usd: "0.7" };
const truncated = { truncated: true, truncation_message: "Response truncated from 10 to 5 items." };

const cases = {
    AccountsOutput: { count: 1, accounts: [{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }] },
    PricesOutput: {
        count: 1,
        prices: [{ symbol: "005930", lastPrice: "72000", currency: "KRW", timestamp: null }],
        ...truncated
    },
    OrderbookOutput: {
        symbol: "005930",
        currency: "KRW",
        timestamp: "2026-03-25T09:30:00.123+09:00",
        asks: [{ price: "72100", volume: "500" }],
        bids: [{ price: "72000", volume: "300" }]
    },
    TradesOutput: {
        symbol: "AAPL",
        count: 1,
        trades: [{ price: "180.55", volume: "10", timestamp: "2026-03-25T23:30:00+09:00", currency: "USD" }],
        ...truncated
    },
    PriceLimitsOutput: { symbol: "005930", currency: "KRW", timestamp: null, upperLimitPrice: null, lowerLimitPrice: null },
    CandlesOutput: {
        symbol: "005930",
        interval: "1d",
        count: 1,
        candles: [
            { timestamp: "2026-03-25T09:00:00+09:00", openPrice: "71600", highPrice: "72300", lowPrice: "71500", closePrice: "72000", volume: "3521000", currency: "KRW" }
        ],
        nextBefore: null,
        ...truncated
    },
    StocksOutput: {
        count: 1,
        stocks: [
            {
                symbol: "005930",
                name: "삼성전자",
                englishName: "SamsungElec",
                isinCode: "KR7005930003",
                market: "KOSPI",
                securityType: "STOCK",
                isCommonShare: true,
                status: "ACTIVE",
                currency: "KRW",
                listDate: "1975-06-11",
                delistDate: null,
                sharesOutstanding: "5919637922",
                leverageFactor: null,
                koreanMarketDetail: { liquidationTrading: false, nxtSupported: true, krxTradingSuspended: false, nxtTradingSuspended: null }
            },
            { symbol: "AAPL", name: "애플", englishName: "Apple", market: "NASDAQ", securityType: "FOREIGN_STOCK", status: "ACTIVE", currency: "USD", koreanMarketDetail: null }
        ],
        ...truncated
    },
    StockWarningsOutput: { symbol: "005930", count: 1, warnings: [{ warningType: "VI_STATIC", exchange: "KRX", startDate: "2026-03-25", endDate: null }] },
    ExchangeRateOutput: {
        baseCurrency: "USD",
        quoteCurrency: "KRW",
        rate: "1350.5",
        midRate: "1350.0",
        basisPoint: "0.5",
        rateChangeType: "UP",
        validFrom: "2026-03-25T09:00:00+09:00",
        validUntil: "2026-03-25T09:01:00+09:00"
    },
    MarketCalendarOutput: {
        country: "KR",
        previousBusinessDay: { date: "2026-03-24", integrated: { regularMarket: { startTime: "09:00", endTime: "15:30" } } },
        today: { date: "2026-03-25", integrated: null },
        nextBusinessDay: { date: "2026-03-26" }
    },
    RankingsOutput: {
        type: "TOP_GAINERS",
        marketCountry: "KR",
        duration: "1d",
        count: 1,
        rankedAt: null,
        rankings: [{ rank: 1, symbol: "005930", currency: "KRW", price: { lastPrice: "72000", basePrice: "70000", changeRate: null }, tradingVolume: "18432100", tradingAmount: "1041436650000" }],
        ...truncated
    },
    MarketIndicatorPricesOutput: { count: 1, prices: [{ symbol: "KOSPI", lastPrice: "2750.12", timestamp: null }] },
    MarketIndicatorCandlesOutput: {
        symbol: "KOSPI",
        interval: "1d",
        count: 1,
        candles: [{ timestamp: "2026-03-25T09:00:00+09:00", openPrice: "2740", highPrice: "2760", lowPrice: "2735", closePrice: "2750", volume: "0", currency: "KRW" }],
        nextBefore: null,
        ...truncated
    },
    InvestorTradingOutput: {
        symbol: "KOSPI",
        interval: "1d",
        count: 1,
        records: [
            {
                date: "2026-03-25",
                updatedAt: "2026-03-25T15:40:00+09:00",
                individual: { buyAmount: "100", sellAmount: "200" },
                foreigner: { buyAmount: "300", sellAmount: "150" },
                institution: { buyAmount: "50", sellAmount: "100", breakdown: { bank: { buyAmount: "1", sellAmount: "2" } } },
                otherCorporation: { buyAmount: "10", sellAmount: "10" }
            }
        ],
        nextUntil: "2026-03-24",
        ...truncated
    },
    HoldingsOutput: {
        accountSeq: 1,
        count: 1,
        totalPurchaseAmount: price,
        marketValue: { amount: price, amountAfterCost: price },
        profitLoss: { amount: price, amountAfterCost: price, rate: "7.5", rateAfterCost: "7.1" },
        dailyProfitLoss: { amount: price, rate: "0.5" },
        items: [
            {
                symbol: "005930",
                name: "삼성전자",
                marketCountry: "KR",
                currency: "KRW",
                quantity: "100",
                lastPrice: "72000",
                averagePurchasePrice: "65000",
                marketValue: { purchaseAmount: "6500000", amount: "7200000", amountAfterCost: "7190000" },
                profitLoss: { amount: "700000", amountAfterCost: "690000", rate: "10.76", rateAfterCost: "10.6" },
                dailyProfitLoss: { amount: "10000", rate: "0.14" },
                cost: { commission: "1000", tax: null }
            }
        ],
        ...truncated
    },
    OrdersOutput: {
        accountSeq: 1,
        status: "CLOSED",
        count: 1,
        orders: [
            {
                orderId: "abc",
                symbol: "005930",
                side: "BUY",
                orderType: "LIMIT",
                timeInForce: "DAY",
                status: "FILLED",
                price: "70000",
                quantity: "10",
                orderAmount: null,
                currency: "KRW",
                orderedAt: "2026-03-29T09:30:00+09:00",
                canceledAt: null,
                execution: { filledQuantity: "10", averageFilledPrice: "70000", filledAmount: "700000", commission: "105", tax: "0", filledAt: "2026-03-29T09:31:00+09:00", settlementDate: "2026-03-31" }
            }
        ],
        nextCursor: null,
        hasNext: false,
        ...truncated
    },
    OrderOutput: {
        accountSeq: 1,
        order: { orderId: "abc", symbol: "AAPL", side: "SELL", orderType: "MARKET", timeInForce: "DAY", status: "CANCELED", price: null, quantity: "1.5", orderAmount: null, currency: "USD", orderedAt: "2026-03-29T23:30:00+09:00", canceledAt: "2026-03-29T23:35:00+09:00", execution: { filledQuantity: "0", averageFilledPrice: null, filledAmount: null, commission: null, tax: null, filledAt: null, settlementDate: null } }
    },
    OrderOperationOutput: { accountSeq: 1, orderId: "abc", operation: "created", note: "Accepted, not filled." },
    BuyingPowerOutput: { accountSeq: 1, currency: "KRW", cashBuyingPower: "5000000" },
    SellableQuantityOutput: { accountSeq: 1, symbol: "005930", sellableQuantity: "100" },
    CommissionsOutput: { accountSeq: 1, count: 1, commissions: [{ marketCountry: "KR", commissionRate: "0.015", startDate: "2026-01-01", endDate: null }] },
    ConditionalOrdersOutput: {
        accountSeq: 1,
        status: "OPEN",
        count: 1,
        conditionalOrders: [
            {
                conditionalOrderId: "gaZIG",
                type: "OCO",
                status: "WATCHING",
                symbol: "005930",
                market: "KR",
                quantity: "100",
                orderType: "LIMIT",
                expireDate: "2026-09-10",
                createdAt: "2026-03-25T09:00:00+09:00",
                first: { type: "STOP", status: "WATCHING", triggerPrice: "80000", targetProfitRate: null, orderPrice: "80000", triggeredOrderId: null },
                second: { type: "STOP", status: "WATCHING", triggerPrice: "60000", targetProfitRate: null, orderPrice: "60000", triggeredOrderId: null }
            }
        ],
        nextCursor: null,
        hasNext: false,
        ...truncated
    },
    ConditionalOrderOutput: {
        accountSeq: 1,
        conditionalOrder: { conditionalOrderId: "gaZIG", type: "SINGLE", status: "COMPLETED", symbol: "AAPL", market: "US", quantity: "5", orderType: "MARKET", expireDate: "2026-09-10", createdAt: "2026-03-25T09:00:00+09:00", first: {}, second: null }
    },
    ConditionalOrderOperationOutput: { accountSeq: 1, conditionalOrderId: "gaZIG", clientOrderId: null, operation: "modified", note: "New id issued." }
};

let failures = 0;
for (const [name, shape] of Object.entries(out)) {
    const payload = cases[name];
    if (!payload) {
        console.log(`⚠ no test payload for ${name}`);
        failures++;
        continue;
    }
    const schema = normalizeObjectSchema(shape);
    const result = safeParse(schema, payload);
    if (result.success) {
        console.log(`✓ ${name}`);
    } else {
        failures++;
        console.log(`✗ ${name}: ${JSON.stringify(result.error?.issues ?? result.error).slice(0, 400)}`);
    }
}
console.log(`\nfailures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
