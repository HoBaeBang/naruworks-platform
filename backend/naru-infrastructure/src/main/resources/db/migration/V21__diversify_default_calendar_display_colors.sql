UPDATE calendars
SET display_color = CASE MOD(id, 8)
    WHEN 0 THEN '#20b977'
    WHEN 1 THEN '#3b82f6'
    WHEN 2 THEN '#f4b942'
    WHEN 3 THEN '#e85d75'
    WHEN 4 THEN '#8b5cf6'
    WHEN 5 THEN '#14b8a6'
    WHEN 6 THEN '#f97316'
    ELSE '#64748b'
END
WHERE display_color = '#20b977';
