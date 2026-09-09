describe('browser-only boot', () => {
	it('boots from a static base path without leaking API requests to a backend', () => {
		const leakedApiRequests: string[] = [];
		cy.intercept('**/api/**', (request) => {
			leakedApiRequests.push(request.url);
			request.continue();
		});

		const basePath = Cypress.env('BASE_PATH') || '';
		cy.visit(`${basePath}/`);
		cy.window().should((window) => {
			expect(window.localStorage.getItem('token')).to.equal('local');
		});
		cy.get('#chat-input', { timeout: 30000 }).should('be.visible');
		cy.location('pathname').should('match', new RegExp(`^${basePath.replaceAll('/', '\\/')}/`));
		cy.wait(500);
		cy.then(() =>
			expect(leakedApiRequests, 'network calls to a real /api backend').to.deep.equal([])
		);
	});
});
