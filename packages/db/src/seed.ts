import { notificationPreferences, tenants, users } from "./schema.js";
import { db, pool } from "./client.js";


// local dev seed
async function seed(): Promise<void> {
  const [tenant] = await db
    .insert(tenants)
    .values({ slug: "acme", name: "Acme Inc" })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      externalUserId: "user-1",
      email: "dev@example.com"
    })
    .returning();

  await db.insert(notificationPreferences).values({
    tenantId: tenant.id,
    userId: user.id,
    category: "billing",
    channel: "both",
    cooldownSecs: 60
  });

  console.log("seeded tenant", tenant.id, "user", user.id);
}


seed()
  .catch((err) => {
    console.error("seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
