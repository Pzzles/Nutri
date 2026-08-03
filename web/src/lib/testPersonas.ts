import fixture from "../fixtures/authenticatedProgressPersonas.json";

export interface TestPersonaCredential {
  id: string;
  label: string;
  description: string;
  mode: "cut" | "maintenance" | "bulk";
  email: string;
  password: string;
}

function configuredPersonas(): TestPersonaCredential[] {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_PERSONAS !== "true") {
    return [];
  }

  return fixture.personas.flatMap((persona, index) => {
    const position = index + 1;
    const email = import.meta.env[`VITE_TEST_PERSONA_${position}_EMAIL`];
    const password = import.meta.env[`VITE_TEST_PERSONA_${position}_PASSWORD`];
    if (!email || !password) return [];
    return [{
      id: persona.id,
      label: persona.selector_label,
      description: persona.description,
      mode: persona.phase.mode as TestPersonaCredential["mode"],
      email,
      password,
    }];
  });
}

export const TEST_PERSONAS = configuredPersonas();

export const TEST_PERSONA_CONFIGURATION_ERROR =
  import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_TEST_PERSONAS === "true" &&
    TEST_PERSONAS.length !== fixture.personas.length
    ? `Expected ${fixture.personas.length} configured test personas, found ${TEST_PERSONAS.length}.`
    : null;
