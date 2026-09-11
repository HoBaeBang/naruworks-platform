package com.naruworks.core.port;

import com.naruworks.domain.model.Calendar;

public interface CalendarWriter {

    Calendar save(Calendar calendar);
}
