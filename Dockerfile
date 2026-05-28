# Use Eclipse Temurin Java 17 runtime for a Spring Boot fat JAR
FROM eclipse-temurin:17-jre-jammy

# Create application directory
WORKDIR /app

# Copy the built Spring Boot JAR into the container
COPY target/upi-offline-mesh-0.0.1-SNAPSHOT.jar app.jar

# Expose default Spring Boot port
EXPOSE 8080

# Run the application
ENTRYPOINT ["java", "-jar", "app.jar"]
