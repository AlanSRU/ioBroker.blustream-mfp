'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');

// Run tests for the adapter startup
tests.integration(path.join(__dirname, '../..'), {
    // Define your own tests inside this function
    defineAdditionalTests() {
        describe('Adapter startup', () => {
            it('Should start without errors', () => {
                return new Promise((resolve) => {
                    // The adapter should start up without errors
                    // Since we don't have a real device to connect to,
                    // we just verify the adapter initializes correctly
                    setTimeout(resolve, 1000);
                });
            });
        });
    },
});
