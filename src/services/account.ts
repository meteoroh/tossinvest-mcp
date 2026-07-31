/**
 * Resolution of the `accountSeq` that account-scoped endpoints require in the
 * `X-Tossinvest-Account` header.
 *
 * Precedence: explicit tool argument > TOSSINVEST_ACCOUNT_SEQ > the single
 * account on the credentials (auto-detected, then cached).
 */

import { TossConfigError } from "../errors.js";
import { apiRequest } from "./client.js";

export interface Account {
    accountNo: string;
    accountSeq: number;
    accountType: string;
}

let cachedAccounts: Account[] | undefined;

export async function listAccounts(forceRefresh = false): Promise<Account[]> {
    if (!cachedAccounts || forceRefresh) {
        cachedAccounts = await apiRequest<Account[]>("/api/v1/accounts");
    }
    return cachedAccounts;
}

function envAccountSeq(): number | undefined {
    const raw = process.env.TOSSINVEST_ACCOUNT_SEQ;
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        throw new TossConfigError(`TOSSINVEST_ACCOUNT_SEQ must be an integer, got "${raw}".`);
    }
    return parsed;
}

export async function resolveAccountSeq(explicit?: number): Promise<number> {
    if (explicit !== undefined) return explicit;

    const fromEnv = envAccountSeq();
    if (fromEnv !== undefined) return fromEnv;

    const accounts = await listAccounts();

    if (accounts.length === 1) {
        return (accounts[0] as Account).accountSeq;
    }

    if (accounts.length === 0) {
        throw new TossConfigError(
            "These credentials have no brokerage (BROKERAGE) account, so account-scoped calls cannot run. Open a Toss Securities brokerage account first."
        );
    }

    const options = accounts.map((account) => `accountSeq=${account.accountSeq} (${account.accountType}, ${account.accountNo})`).join("; ");
    throw new TossConfigError(
        `Multiple accounts are available, so account_seq must be specified explicitly. Options: ${options}. Alternatively set TOSSINVEST_ACCOUNT_SEQ.`
    );
}
