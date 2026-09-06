import {randomUUID} from 'node:crypto';

export async function claimAnalysisCronSlot(sql) {
  const token=randomUUID();
  const [slot]=await sql`INSERT INTO creative_analysis_cron_slots(run_key,run_date,run_hour,lease_token)
    VALUES (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD-HH24'),CURRENT_DATE,
      EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::int,${token})
    ON CONFLICT(run_key) DO UPDATE SET started_at=now(),lease_token=EXCLUDED.lease_token
    WHERE creative_analysis_cron_slots.completed_at IS NULL
      AND creative_analysis_cron_slots.started_at<now()-interval '10 minutes'
    RETURNING run_key,lease_token`;
  return slot || null;
}

export async function completeAnalysisCronSlot(sql,slot,processed) {
  const rows=await sql`UPDATE creative_analysis_cron_slots SET completed_at=now(),processed=${processed}
    WHERE run_key=${slot.run_key} AND lease_token=${slot.lease_token} AND completed_at IS NULL RETURNING run_key`;
  return rows.length>0;
}
