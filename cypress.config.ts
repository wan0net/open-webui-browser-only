import { defineConfig } from 'cypress';

export default defineConfig({
	e2e: {
		baseUrl: 'http://127.0.0.1:4173',
		supportFile: false,
		specPattern: 'cypress/e2e/**/*.cy.{js,ts}'
	},
	video: false,
	retries: 1
});
