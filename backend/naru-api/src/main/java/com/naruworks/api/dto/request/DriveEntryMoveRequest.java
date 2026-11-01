package com.naruworks.api.dto.request;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record DriveEntryMoveRequest(
        @NotNull Destination destination,
        @Positive Long parentId
) {
    public enum Destination { ROOT, FOLDER }

    @AssertTrue(message = "ROOT에는 parentId가 없어야 하고 FOLDER에는 parentId가 필요합니다.")
    public boolean isDestinationValid() {
        return destination != null && (destination == Destination.ROOT ? parentId == null : parentId != null);
    }
}
