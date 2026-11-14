import { test, expect, type Page } from "@playwright/test";

async function customer(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Customer workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "What does your kitchen need?" }),
  ).toBeVisible();
}

test("routine basket is ordered automatically and has a receipt", async ({
  page,
}) => {
  await customer(page);
  await page.getByRole("button", { name: /01 Routine purchase/ }).click();
  await page.getByRole("button", { name: "Ask purchasing agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo order placed." }),
  ).toBeVisible();
  await expect(page.getByText(/Ordered automatically\./)).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByText(/2 items/)).toBeVisible();
});

test("large basket pauses, shows alternatives, and only orders after approval", async ({
  page,
}) => {
  await customer(page);
  await page
    .getByRole("button", { name: /02 Purchase requiring approval/ })
    .click();
  await page.getByRole("button", { name: "Ask purchasing agent" }).click();
  await expect(
    page.getByRole("heading", { name: "This basket needs your approval." }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        "1,500 L of milk exceeds your 1,000 L automatic limit for this delivery.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review and approve" }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Compare alternatives" })
    .first()
    .click();
  await expect(page.getByText("Eligible alternative").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve and place order" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo order placed." }),
  ).toBeVisible();
  await expect(page.getByText(/Approved by demo customer\./)).toBeVisible();
});

test("customer can reject without creating an order", async ({ page }) => {
  await customer(page);
  await page
    .getByRole("button", { name: /02 Purchase requiring approval/ })
    .click();
  await page.getByRole("button", { name: "Ask purchasing agent" }).click();
  await page.getByRole("link", { name: "Review and approve" }).click();
  await page
    .getByRole("button", { name: "Reject basket", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Reject basket" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rejected — no order placed." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No orders placed yet" }),
  ).toBeVisible();
});

test("rules are editable and Aimo can inspect but not approve", async ({
  page,
}) => {
  await customer(page);
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await page
    .getByLabel("Automatic quantity limit 1", { exact: true })
    .fill("400");
  await page.getByRole("button", { name: "Save purchasing rules" }).click();
  await expect(page.getByText("Rules saved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Purchase", exact: true }).click();
  await page.getByRole("button", { name: /01 Routine purchase/ }).click();
  await page.getByRole("button", { name: "Ask purchasing agent" }).click();
  await expect(
    page.getByRole("heading", { name: "This basket needs your approval." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Switch workspace" }).click();
  await page.getByRole("button", { name: /Aimo workspace/ }).click();
  await page.getByRole("link", { name: /lactose-free milk/ }).click();
  await expect(
    page.getByRole("heading", { name: "Execution timeline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve and place order" }),
  ).toHaveCount(0);
});

test("structured clarification is usable without Gemini and layout fits", async ({
  page,
}) => {
  await customer(page);
  await page.getByRole("button", { name: "Enter basket lines" }).click();
  await page.getByLabel("Quantity 1", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Ask purchasing agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo order placed." }),
  ).toBeVisible();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});
