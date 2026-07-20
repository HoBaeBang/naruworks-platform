FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
COPY naru-api ./naru-api
COPY naru-core ./naru-core
COPY naru-domain ./naru-domain
COPY naru-infrastructure ./naru-infrastructure

RUN chmod +x ./gradlew
RUN ./gradlew :naru-api:bootJar --no-daemon

FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

COPY --from=build /workspace/naru-api/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
