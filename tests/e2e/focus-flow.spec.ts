import { expect, test } from "@playwright/test";

test("user can register, plan a session, save stats, and persist notes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Your name").fill("Mira");
  await page.getByPlaceholder("you@example.com").fill(`mira-${Date.now()}@example.local`);
  await page.getByPlaceholder("8 characters minimum").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Focus timer" })).toBeVisible();
  await expect(page.getByText("No tasks yet.")).toBeVisible();

  await page.getByPlaceholder("Add a task").fill("Write the launch outline");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByTitle("Add task").click();

  await expect(page.getByRole("button", { name: /Write the launch outline/ })).toBeVisible();
  await page.getByLabel("Session reason").fill("Turn the rough plan into a launch outline");
  await page.getByTitle("Complete").click();
  await expect(page.getByText("Signal charged")).toBeVisible();
  await expect(page.locator(".metric").filter({ hasText: "Today" }).getByText("25m")).toBeVisible();
  await expect(page.getByText("Turn the rough plan into a launch outline")).toBeVisible();

  await page.getByTitle("New note").click();
  await page.locator(".note-title").first().fill("Outline");
  await page.locator(".note-card textarea").first().fill("Start with the problem and the promise.");
  const noteSave = page.waitForResponse(
    (response) =>
      response.url().includes("/api/notes/") &&
      response.request().method() === "PATCH" &&
      Boolean(response.request().postData()?.includes("Start with the problem"))
  );
  await page.locator(".note-card textarea").first().blur();
  await noteSave;
  await page.reload();

  await expect(page.locator(".note-title").first()).toHaveValue("Outline");
  await expect(page.locator(".note-card textarea").first()).toHaveValue(
    "Start with the problem and the promise."
  );

  await page.getByTitle("Dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("dashboard fits on mobile without horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Your name").fill("Noor");
  await page.getByPlaceholder("you@example.com").fill(`noor-${Date.now()}@example.local`);
  await page.getByPlaceholder("8 characters minimum").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Focus timer" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
