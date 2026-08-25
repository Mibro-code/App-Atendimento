// Contrato que qualquer provider de IA usado pelo interpretador de Bots deve seguir.
// Nenhuma parte do motor deve depender diretamente de um provider específico.

class AIProvider {
  // Deve retornar { intentId, confidence, entities } ou null quando não conseguir classificar.
  async classifyIntent(_input) {
    throw new Error("classifyIntent não implementado neste provider.");
  }

  // Deve retornar um objeto de entidades brutas (validadas depois pelo chamador).
  async extractEntities(_input) {
    throw new Error("extractEntities não implementado neste provider.");
  }

  // Deve retornar uma string curta de resposta, nunca texto livre não solicitado.
  async generateResponse(_input) {
    throw new Error("generateResponse não implementado neste provider.");
  }
}

module.exports = { AIProvider };
