import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

describe("public-kudos", () => {
    it("give-kudos increments category and total counters", () => {
        const gave = simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet2), Cl.uint(1)], wallet1);
        expect(gave.result).toBeOk(Cl.bool(true));

        const cat = simnet.callReadOnlyFn("public-kudos", "get-category-count", [Cl.principal(wallet2), Cl.uint(1)], wallet1);
        expect(cat.result).toBeOk(Cl.uint(1));

        const total = simnet.callReadOnlyFn("public-kudos", "get-total-kudos", [Cl.principal(wallet2)], wallet1);
        expect(total.result).toBeOk(Cl.uint(1));
    });

    it("self-kudos fails", () => {
        const gave = simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet1), Cl.uint(1)], wallet1);
        expect(gave.result).toBeErr(Cl.uint(101));
    });

    it("duplicate kudos fails", () => {
        simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet2), Cl.uint(2)], wallet1);
        const second = simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet2), Cl.uint(2)], wallet1);
        expect(second.result).toBeErr(Cl.uint(102));
    });

    it("revoke decrements counters", () => {
        simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet2), Cl.uint(3)], wallet1);
        simnet.mineEmptyBlocks(5);
        const revoked = simnet.callPublicFn("public-kudos", "revoke-kudos", [Cl.principal(wallet2), Cl.uint(3)], wallet1);
        expect(revoked.result).toBeOk(Cl.bool(true));

        const cat = simnet.callReadOnlyFn("public-kudos", "get-category-count", [Cl.principal(wallet2), Cl.uint(3)], wallet1);
        expect(cat.result).toBeOk(Cl.uint(0));

        const total = simnet.callReadOnlyFn("public-kudos", "get-total-kudos", [Cl.principal(wallet2)], wallet1);
        expect(total.result).toBeOk(Cl.uint(0));
    });

    it("revoke missing record fails", () => {
        const revoked = simnet.callPublicFn("public-kudos", "revoke-kudos", [Cl.principal(wallet2), Cl.uint(4)], wallet1);
        expect(revoked.result).toBeErr(Cl.uint(103));
    });

    it("cooldown blocks rapid repeat actions", () => {
        simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet2), Cl.uint(5)], wallet1);
        const revokedEarly = simnet.callPublicFn("public-kudos", "revoke-kudos", [Cl.principal(wallet2), Cl.uint(5)], wallet1);
        expect(revokedEarly.result).toBeErr(Cl.uint(104));

        simnet.mineEmptyBlocks(5);
        const revokedAfter = simnet.callPublicFn("public-kudos", "revoke-kudos", [Cl.principal(wallet2), Cl.uint(5)], wallet1);
        expect(revokedAfter.result).toBeOk(Cl.bool(true));
    });

    it("multiple users can endorse same recipient across categories", () => {
        simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet3), Cl.uint(1)], wallet1);
        simnet.callPublicFn("public-kudos", "give-kudos", [Cl.principal(wallet3), Cl.uint(2)], wallet2);

        const cat1 = simnet.callReadOnlyFn("public-kudos", "get-category-count", [Cl.principal(wallet3), Cl.uint(1)], wallet1);
        const cat2 = simnet.callReadOnlyFn("public-kudos", "get-category-count", [Cl.principal(wallet3), Cl.uint(2)], wallet1);
        const total = simnet.callReadOnlyFn("public-kudos", "get-total-kudos", [Cl.principal(wallet3)], wallet1);

        expect(cat1.result).toBeOk(Cl.uint(1));
        expect(cat2.result).toBeOk(Cl.uint(1));
        expect(total.result).toBeOk(Cl.uint(2));
    });
});
