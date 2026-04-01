package service

// GenerateTestToken creates a JWT token for testing purposes.
func GenerateTestToken(userID string) (string, error) {
	return generateToken(userID)
}
