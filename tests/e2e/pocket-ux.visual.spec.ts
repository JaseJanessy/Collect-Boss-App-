import { expect, test } from "@playwright/test";

const viewports = [
  { name:"phone", width:390, height:844 },
  { name:"tablet", width:834, height:1112 },
  { name:"laptop", width:1440, height:900 },
] as const;

for(const viewport of viewports) {
  test(`Pocket home is responsive at ${viewport.name} width`,async({page})=>{
    await page.setViewportSize(viewport);
    await page.goto("/dev/pocket-ux");
    await page.addStyleTag({content:"nextjs-portal{display:none!important}"});
    await expect(page.getByRole("heading",{name:"Today",level:1})).toBeVisible({timeout:30_000});
    const visibleWordmark=page.locator('[data-brand-wordmark="collectboss-pocket"]:visible').first();
    await expect(visibleWordmark).toBeVisible();
    await expect(page.getByText("Today to Collect")).toBeVisible();
    await expect(page.getByRole("button",{name:"Add Debt"})).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const wordmarkColors=await visibleWordmark.locator(":scope > span").evaluateAll((parts)=>parts.map((part)=>getComputedStyle(part).color));
    expect(wordmarkColors).toEqual(["rgb(13, 27, 61)","rgb(0, 153, 102)"]);
    await expect(page).toHaveScreenshot(`pocket-home-${viewport.name}.png`,{fullPage:true,animations:"disabled"});
  });
}

test("Pocket remains keyboard usable at high text scale",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/dev/pocket-ux");
  await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
  for(let index=0;index<10;index+=1){
    await page.keyboard.press("Tab");
    const focusIsInPocket=await page.evaluate(()=>Boolean(document.activeElement?.closest(".pocket-root")));
    if(focusIsInPocket) break;
  }
  const focused=page.locator(".pocket-root :focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).toBeVisible();
  expect(await focused.evaluate((element)=>["A","BUTTON","INPUT"].includes(element.tagName))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Pocket action accents stay scoped away from Main",async({page})=>{
  await page.goto("/dev/pocket-ux");
  const accents=await page.locator("[data-pocket-action] .pocket-action-icon").evaluateAll((nodes)=>nodes.map((node)=>getComputedStyle(node).color));
  expect(new Set(accents).size).toBe(4);
  await page.goto("/landing");
  await expect(page.locator("[data-pocket-theme]")).toHaveCount(0);
  await expect(page.locator('[data-brand-wordmark="collectboss-main"]').first()).toBeVisible();
});

test("Pocket supports reduced motion and system dark preference without losing its identity",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce",colorScheme:"dark"});
  await page.goto("/dev/pocket-ux");
  await expect(page.getByText("CollectBoss Pocket").first()).toBeVisible();
  const durationMs=await page.getByRole("button",{name:"Add Debt"}).evaluate((element)=>getComputedStyle(element).transitionDuration.split(",").map((value)=>value.trim().endsWith("ms")?Number.parseFloat(value):Number.parseFloat(value)*1000));
  expect(Math.max(...durationMs)).toBeLessThanOrEqual(1);
});

for(const state of ["loading","empty","permission","quota","past-due","offline","error"] as const) {
  test(`Pocket ${state} state is readable`,async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`/dev/pocket-ux?state=${state}`);
    await expect(page.getByRole("heading",{name:"Today",level:1})).toBeVisible({timeout:30_000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
    if(state==="error") await expect(page.getByRole("button",{name:"Retry"})).toBeVisible();
  });
}
