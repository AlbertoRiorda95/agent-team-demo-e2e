"""The global launch window: after an accepted launch, no other one for `window_s` seconds.

Rejected requests do not restart it (docs/design/launch-intake.md).
"""

import math
from datetime import datetime


def remaining_s(window_s: int, claimed_at: datetime, now: datetime) -> int | None:
    """Seconds left in the window claimed at `claimed_at`, rounded up; None once it is over.

    A request exactly `window_s` seconds after the claim is accepted (None). The
    result is between 1 and `window_s`, also when `now` is before `claimed_at`
    (clock skew between the api and the NATS server).
    """
    elapsed = (now - claimed_at).total_seconds()
    if elapsed >= window_s:
        return None
    return min(window_s, max(1, math.ceil(window_s - elapsed)))
