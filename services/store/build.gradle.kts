// store: consumes the trajectory messages from NATS and keeps them in
// PostgreSQL (schema managed by Flyway). Foundations skeleton: it applies the
// migrations and connects to NATS at start-up, nothing more yet.
plugins {
    application
}

group = "trajectory"
version = "0.0.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.flywaydb:flyway-core:13.13.0")
    implementation("org.flywaydb:flyway-database-postgresql:13.13.0")
    implementation("io.nats:jnats:2.27.0")
    runtimeOnly("org.postgresql:postgresql:42.7.14")

    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.testcontainers:testcontainers-postgresql:2.0.5")
    testRuntimeOnly("org.postgresql:postgresql:42.7.14")
}

application {
    mainClass = "trajectory.store.Main"
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
    }
}
