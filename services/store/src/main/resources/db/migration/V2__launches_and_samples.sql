-- V2__launches_and_samples: the computed trajectories (docs/design/persistence.md
-- > Data and API). ${prefix} is the table prefix in force (Flyway placeholder:
-- empty by default, or ^[a-z][a-z0-9_]{0,15}$); every table, index and
-- constraint name carries it, so two prefixes live side by side in one schema.
-- Additive only.
--
-- Reverse (by hand; history is kept forever, so only on a database without data):
--   DROP TABLE ${prefix}trajectory_samples;
--   DROP TABLE ${prefix}launches;
--   DELETE FROM ${prefix}flyway_schema_history WHERE version = '2';

CREATE TABLE ${prefix}launches (
    id                 uuid             NOT NULL,
    received_at        timestamptz      NOT NULL,
    computed_at        timestamptz      NOT NULL,
    stored_at          timestamptz      NOT NULL DEFAULT now(),
    mass_kg            double precision NOT NULL,
    x_m                double precision NOT NULL,
    y_m                double precision NOT NULL,
    z_m                double precision NOT NULL,
    azimuth_deg        double precision NOT NULL,
    elevation_deg      double precision NOT NULL,
    force_n            double precision NOT NULL,
    burn_duration_s    double precision NOT NULL,
    propagation_time_s double precision NOT NULL,
    sample_step_s      double precision NOT NULL,
    gravity_mps2       double precision NOT NULL,
    config_version     bigint           NOT NULL,
    status             text             NOT NULL,
    end_reason         text             NOT NULL,
    flight_time_s      double precision NOT NULL,
    max_height_m       double precision NOT NULL,
    range_m            double precision NOT NULL,
    sample_count       integer          NOT NULL,
    CONSTRAINT ${prefix}launches_pkey PRIMARY KEY (id),
    CONSTRAINT ${prefix}launches_status_check
        CHECK (status IN ('accepted', 'computed', 'stored', 'failed')),
    CONSTRAINT ${prefix}launches_end_reason_check
        CHECK (end_reason IN ('ground', 'time_limit'))
);

-- the history list, newest first
CREATE INDEX ${prefix}launches_received_at_idx ON ${prefix}launches (received_at DESC);

CREATE TABLE ${prefix}trajectory_samples (
    launch_id uuid             NOT NULL,
    seq       integer          NOT NULL,
    t_s       double precision NOT NULL,
    x_m       double precision NOT NULL,
    y_m       double precision NOT NULL,
    z_m       double precision NOT NULL,
    vx_mps    double precision NOT NULL,
    vy_mps    double precision NOT NULL,
    vz_mps    double precision NOT NULL,
    phase     text             NOT NULL,
    CONSTRAINT ${prefix}trajectory_samples_pkey PRIMARY KEY (launch_id, seq),
    CONSTRAINT ${prefix}trajectory_samples_launch_id_fkey
        FOREIGN KEY (launch_id) REFERENCES ${prefix}launches (id),
    CONSTRAINT ${prefix}trajectory_samples_phase_check
        CHECK (phase IN ('burn', 'ballistic'))
);
