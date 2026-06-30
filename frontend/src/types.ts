export interface Model {
  id: string;
  name: string;
  provider: string;
  hex: string;
  tw: string;
  isCustom?: boolean;
  nodeAddress?: string;
  isFree?: boolean;
  pricing?: { prompt: string; completion: string };
}

export interface Message {
  role: "user" | "model";
  text: string;
}

export interface CardData extends Model {
  cardId: string;
  state: "loading" | "complete" | "error";
  messages: Message[];
  councilMembers?: Model[];
}

export interface User {
  name: string;
  email?: string;
  photo: string | null;
  isAuthenticated: boolean;
}
