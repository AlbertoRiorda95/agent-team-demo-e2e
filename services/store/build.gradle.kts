// store: consumes the trajectory messages from NATS and keeps them in
// PostgreSQL (schema managed by Flyway).
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

sourceSets {
    main {
        // the committed Java code of proto/trajectory (scripts/generate-proto.sh)
        java.srcDir("src/main/generated")
    }
}

dependencies {
    implementation("org.flywaydb:flyway-core:13.13.0")
    implementation("org.flywaydb:flyway-database-postgresql:13.13.0")
    implementation("io.nats:jnats:2.27.0")
    // the runtime of the generated code: the version of buf.gen.yaml (protobuf v33.1)
    implementation("com.google.protobuf:protobuf-java:4.33.1")
    // COPY for the samples (CopyManager) needs the driver API at compile time
    implementation("org.postgresql:postgresql:42.7.14")

    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.testcontainers:testcontainers-postgresql:2.0.5")
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

tasks.jar {
    manifest {
        // read by StoreService.version() for the status.store heartbeat
        attributes("Implementation-Version" to project.version)
    }
}
