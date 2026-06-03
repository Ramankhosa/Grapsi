SELECT datname, count(*) AS conns, array_agg(DISTINCT application_name) AS apps
FROM pg_stat_activity
WHERE datname IS NOT NULL
GROUP BY datname
ORDER BY conns DESC;
