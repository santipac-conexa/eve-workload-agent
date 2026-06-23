import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";

import { upsertSlackInfo } from "../lib/users.js";

const UID = () => process.env.SLACK_CONNECT_UID ?? "slack/time-tracker";

export default slackChannel({
  credentials: connectSlackCredentials(UID()),
  async onDirectMessage(ctx, message) {
    const userId = message.author?.userId;
    if (!userId) return null;
    const channelId = message.channelId;

    let email: string | undefined;
    try {
      const res = await ctx.slack.request("users.info", { user: userId });
      if (res.ok) {
        email = (res as { user?: { profile?: { email?: string } } }).user?.profile?.email;
      }
    } catch {
      // best-effort: sin scope users:read.email seguimos sin email
    }

    try {
      await upsertSlackInfo({
        slackUserId: userId,
        slackChannelId: channelId,
        slackUserEmail: email,
      });
    } catch (err) {
      console.warn("[slack] upsertSlackInfo failed", err);
    }

    const auth = defaultSlackAuth(message, ctx);
    return auth ? { auth } : null;
  },
});
